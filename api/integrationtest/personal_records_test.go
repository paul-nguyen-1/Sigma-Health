package integrationtest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

// TestPersonalRecordsSyncTrigger exercises sync_personal_records (migration
// 0015): personal_records is derived entirely from workouts.exercises, with
// no direct write path for clients -- it can only be right if the trigger
// picks the best set per exercise, normalizes exercise names so casing
// doesn't fragment a lift into multiple PR rows, and never lets a worse set
// overwrite an existing best.
func TestPersonalRecordsSyncTrigger(t *testing.T) {
	pool := testPool(t)
	erin := createUser(t, pool, "Erin")
	ctx := context.Background()

	// 135x8 (1RM 171) beats 145x5 (1RM ~169.17) despite being logged
	// first, and "  BENCH press " should match the same PR row as
	// "Bench Press" rather than creating a second one.
	var workoutID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO workouts (user_id, title, exercises)
		VALUES ($1, 'Chest Day', $2::jsonb)
		RETURNING id`,
		erin,
		`[
			{"name": "Bench Press", "sets": [{"weight": 135, "reps": 8}, {"weight": 145, "reps": 5}]},
			{"name": "  BENCH press ", "sets": [{"weight": 100, "reps": 3}]}
		]`,
	).Scan(&workoutID); err != nil {
		t.Fatalf("insert workout: %v", err)
	}

	var weight float64
	var reps, rowCount int
	if err := pool.QueryRow(ctx,
		"SELECT best_weight, best_reps FROM personal_records WHERE user_id = $1 AND exercise_name = 'bench press'",
		erin,
	).Scan(&weight, &reps); err != nil {
		t.Fatalf("select PR: %v", err)
	}
	if weight != 135 || reps != 8 {
		t.Errorf("best set = %vx%v, want 135x8 (the higher-1RM set should win)", weight, reps)
	}
	if err := pool.QueryRow(ctx,
		"SELECT count(*) FROM personal_records WHERE user_id = $1", erin,
	).Scan(&rowCount); err != nil {
		t.Fatalf("count PRs: %v", err)
	}
	if rowCount != 1 {
		t.Errorf("expected exactly 1 PR row (case/whitespace variants of the same lift should merge), got %d", rowCount)
	}

	// A worse set logged later must not overwrite the existing PR.
	if _, err := pool.Exec(ctx,
		`UPDATE workouts SET exercises = '[{"name": "Bench Press", "sets": [{"weight": 115, "reps": 5}]}]'::jsonb WHERE id = $1`,
		workoutID,
	); err != nil {
		t.Fatalf("update workout (worse set): %v", err)
	}
	if err := pool.QueryRow(ctx,
		"SELECT best_weight FROM personal_records WHERE user_id = $1 AND exercise_name = 'bench press'", erin,
	).Scan(&weight); err != nil {
		t.Fatalf("select PR: %v", err)
	}
	if weight != 135 {
		t.Errorf("a worse set overwrote the PR: best_weight = %v, want 135", weight)
	}

	// A genuinely better set must overwrite it.
	if _, err := pool.Exec(ctx,
		`UPDATE workouts SET exercises = '[{"name": "Bench Press", "sets": [{"weight": 155, "reps": 5}]}]'::jsonb WHERE id = $1`,
		workoutID,
	); err != nil {
		t.Fatalf("update workout (better set): %v", err)
	}
	if err := pool.QueryRow(ctx,
		"SELECT best_weight FROM personal_records WHERE user_id = $1 AND exercise_name = 'bench press'", erin,
	).Scan(&weight); err != nil {
		t.Fatalf("select PR: %v", err)
	}
	if weight != 155 {
		t.Errorf("a genuinely better set should have updated the PR: best_weight = %v, want 155", weight)
	}

	// personal_records has SELECT-only RLS -- own rows are visible, but
	// there's no INSERT policy at all, so a direct client write is blocked
	// regardless of whose id it claims.
	asUser(t, pool, erin, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM personal_records").Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("erin should see exactly her 1 PR row via RLS, saw %d", count)
		}

		_, err := tx.Exec(ctx,
			"INSERT INTO personal_records (user_id, exercise_name, best_weight, best_reps) VALUES ($1, 'fake lift', 999, 1)",
			erin,
		)
		if err == nil {
			t.Error("a direct client insert into personal_records should be blocked (no write policy), but it succeeded")
		}
	})
}
