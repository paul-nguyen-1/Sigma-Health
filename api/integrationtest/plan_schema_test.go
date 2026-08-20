package integrationtest

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// TestGenerateUserPlanSessionsTrigger exercises generate_user_plan_sessions
// (migration 0016): starting a plan must never let a client skip,
// duplicate, or fabricate scheduled sessions -- the trigger is the only
// thing that ever writes user_plan_sessions rows.
func TestGenerateUserPlanSessionsTrigger(t *testing.T) {
	pool := testPool(t)
	dana := createUser(t, pool, "Dana")
	ctx := context.Background()

	var templateID string
	if err := pool.QueryRow(ctx,
		"SELECT id FROM plan_templates WHERE name = 'Beginner Strength'",
	).Scan(&templateID); err != nil {
		t.Fatalf("lookup seeded template: %v", err)
	}

	startedAt := time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC)
	var userPlanID string
	if err := pool.QueryRow(ctx,
		"INSERT INTO user_plans (user_id, plan_template_id, started_at) VALUES ($1, $2, $3) RETURNING id",
		dana, templateID, startedAt,
	).Scan(&userPlanID); err != nil {
		t.Fatalf("insert user_plans: %v", err)
	}

	rows, err := pool.Query(ctx,
		`SELECT ps.day_offset, ups.scheduled_date
		 FROM user_plan_sessions ups
		 JOIN plan_sessions ps ON ps.id = ups.plan_session_id
		 WHERE ups.user_plan_id = $1
		 ORDER BY ps.day_offset`,
		userPlanID,
	)
	if err != nil {
		t.Fatalf("select generated sessions: %v", err)
	}
	defer rows.Close()

	var count int
	for rows.Next() {
		var dayOffset int
		var scheduledDate time.Time
		if err := rows.Scan(&dayOffset, &scheduledDate); err != nil {
			t.Fatalf("scan: %v", err)
		}
		want := startedAt.AddDate(0, 0, dayOffset)
		if !scheduledDate.Equal(want) {
			t.Errorf("day_offset %d: scheduled_date = %v, want %v", dayOffset, scheduledDate, want)
		}
		count++
	}
	if count != 3 {
		t.Errorf("expected 3 generated sessions (Beginner Strength has 3 plan_sessions rows), got %d", count)
	}
}

// TestUserPlansSelfOnly mirrors the self-only RLS shape every Phase 1
// table has: a user can create/see their own plans, not anyone else's.
func TestUserPlansSelfOnly(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")
	ctx := context.Background()

	var templateID string
	if err := pool.QueryRow(ctx, "SELECT id FROM plan_templates WHERE name = 'Couch to 5K'").Scan(&templateID); err != nil {
		t.Fatalf("lookup seeded template: %v", err)
	}

	asUser(t, pool, bob, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO user_plans (user_id, plan_template_id) VALUES ($1, $2)", bob, templateID,
		)
		if err != nil {
			t.Fatalf("bob starting his own plan should succeed: %v", err)
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO user_plans (user_id, plan_template_id) VALUES ($1, $2)", bob, templateID,
		)
		if err == nil {
			t.Error("alice should NOT be able to start a plan for bob, but the insert succeeded")
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM user_plans").Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 0 {
			t.Errorf("alice should see 0 user_plans (bob's from a separate transaction shouldn't be visible), saw %d", count)
		}
	})
}

// TestUserPlanSessionsNoDirectWrite confirms the write-lockdown that
// makes the trigger authoritative: self-only SELECT/UPDATE, but no
// INSERT or DELETE policy at all, so a client can't add/remove sessions
// to game a streak -- only the generate_user_plan_sessions trigger and a
// self-only "mark complete" UPDATE are possible.
func TestUserPlanSessionsNoDirectWrite(t *testing.T) {
	pool := testPool(t)
	erin := createUser(t, pool, "Erin")
	ctx := context.Background()

	var templateID string
	if err := pool.QueryRow(ctx, "SELECT id FROM plan_templates WHERE name = 'Beginner Strength'").Scan(&templateID); err != nil {
		t.Fatalf("lookup seeded template: %v", err)
	}
	var userPlanID string
	if err := pool.QueryRow(ctx,
		"INSERT INTO user_plans (user_id, plan_template_id) VALUES ($1, $2) RETURNING id", erin, templateID,
	).Scan(&userPlanID); err != nil {
		t.Fatalf("insert user_plans: %v", err)
	}
	var planSessionID string
	if err := pool.QueryRow(ctx, "SELECT id FROM plan_sessions WHERE plan_template_id = $1 LIMIT 1", templateID).
		Scan(&planSessionID); err != nil {
		t.Fatalf("lookup plan_sessions: %v", err)
	}

	asUser(t, pool, erin, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM user_plan_sessions").Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 3 {
			t.Errorf("erin should see her 3 trigger-generated sessions, saw %d", count)
		}
	})

	asUser(t, pool, erin, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO user_plan_sessions (user_plan_id, plan_session_id, scheduled_date) VALUES ($1, $2, now())",
			userPlanID, planSessionID,
		)
		if err == nil {
			t.Error("a direct client insert into user_plan_sessions should be blocked (no write policy), but it succeeded")
		}
	})

	asUser(t, pool, erin, func(tx pgx.Tx) {
		result, err := tx.Exec(context.Background(),
			"UPDATE user_plan_sessions SET completed_at = now() WHERE user_plan_id = $1", userPlanID,
		)
		if err != nil {
			t.Fatalf("erin marking her own session complete should succeed: %v", err)
		}
		if result.RowsAffected() == 0 {
			t.Error("expected at least one session row to be updated")
		}
	})
}

// TestDailySessionsPublicRead confirms daily_sessions has no ownership
// concept at all -- any authenticated user can read any row.
func TestDailySessionsPublicRead(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	ctx := context.Background()

	var runningSportID string
	if err := pool.QueryRow(ctx, "SELECT id FROM sports WHERE slug = 'running'").Scan(&runningSportID); err != nil {
		t.Fatalf("lookup sport: %v", err)
	}
	if _, err := pool.Exec(ctx,
		"INSERT INTO daily_sessions (sport_id, date, title, target) VALUES ($1, $2, $3, $4)",
		runningSportID, "2026-02-01", "WOD", `{"distanceKm": 3, "targetPaceSecPerKm": null}`,
	); err != nil {
		t.Fatalf("fixture insert as superuser: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM daily_sessions").Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("alice should see the daily_sessions row (public read, no owner), saw %d", count)
		}
	})
}
