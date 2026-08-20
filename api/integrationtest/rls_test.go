package integrationtest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestProfilesSelfOnly(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	_ = createUser(t, pool, "Bob")

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM profiles").Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("alice should see exactly her own profile (1 row), saw %d", count)
		}
	})
}

func TestCheckInsSelfOnly(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO check_ins (user_id, location_type, location_id, expires_at) VALUES ($1, 'gym', gen_random_uuid(), now() + interval '3 hours')",
			alice,
		)
		if err != nil {
			t.Errorf("alice should be able to check herself in: %v", err)
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO check_ins (user_id, location_type, location_id, expires_at) VALUES ($1, 'gym', gen_random_uuid(), now() + interval '3 hours')",
			bob,
		)
		if err == nil {
			t.Error("alice should NOT be able to check bob in, but the insert succeeded")
		}
	})
}

func TestPersonalRecordsSelfOnly(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	asUser(t, pool, bob, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO personal_records (user_id, lift_name, weight, reps) VALUES ($1, 'bench', 100, 5)", bob,
		)
		if err != nil {
			t.Fatalf("bob logging his own PR should succeed: %v", err)
		}
	})

	// A failed statement aborts the rest of the Postgres transaction, so
	// this needs its own transaction rather than reusing the one above.
	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO personal_records (user_id, lift_name, weight, reps) VALUES ($1, 'squat', 200, 3)", bob,
		)
		if err == nil {
			t.Error("alice should NOT be able to insert a PR for bob, but the insert succeeded")
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM personal_records").Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 0 {
			t.Errorf("alice should see 0 personal_records (bob's PR from a separate transaction shouldn't be visible to her), saw %d", count)
		}
	})
}

func TestRunsSelfOnly(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO runs (user_id, distance_km, duration_seconds) VALUES ($1, 5.0, 1500)", alice,
		)
		if err != nil {
			t.Fatalf("alice logging her own run should succeed: %v", err)
		}
	})

	asUser(t, pool, bob, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO runs (user_id, distance_km, duration_seconds) VALUES ($1, 10.0, 3000)", alice,
		)
		if err == nil {
			t.Error("bob should NOT be able to insert a run for alice, but the insert succeeded")
		}
	})
}

func TestModerationBansInvisibleToAuthenticated(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")

	_, err := pool.Exec(context.Background(),
		"INSERT INTO moderation_bans (user_id, reason, phone_number_hash, banned_at) VALUES ($1, 'test', 'deadbeef', now())",
		alice,
	)
	if err != nil {
		t.Fatalf("fixture insert as superuser: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM moderation_bans").Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 0 {
			t.Errorf("authenticated role should see 0 moderation_bans rows even for its own ban, saw %d", count)
		}

		_, err := tx.Exec(context.Background(),
			"INSERT INTO moderation_bans (user_id, reason, phone_number_hash, banned_at) VALUES ($1, 'self-inserted', 'cafef00d', now())",
			alice,
		)
		if err == nil {
			t.Error("authenticated role should NOT be able to insert into moderation_bans, but it succeeded")
		}
	})
}

func TestReportsAndBlocksSelfOnly(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	asUser(t, pool, alice, func(tx pgx.Tx) {
		if _, err := tx.Exec(context.Background(),
			"INSERT INTO reports (reporter_id, reported_user_id, reason) VALUES ($1, $2, 'spam')", alice, bob,
		); err != nil {
			t.Fatalf("alice reporting bob should succeed: %v", err)
		}
		if _, err := tx.Exec(context.Background(),
			"INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)", alice, bob,
		); err != nil {
			t.Fatalf("alice blocking bob should succeed: %v", err)
		}
	})

	asUser(t, pool, bob, func(tx pgx.Tx) {
		var reportCount, blockCount int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM reports").Scan(&reportCount); err != nil {
			t.Fatalf("select reports: %v", err)
		}
		if reportCount != 0 {
			t.Errorf("bob should not see the report alice filed against him, saw %d rows", reportCount)
		}
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM blocks").Scan(&blockCount); err != nil {
			t.Fatalf("select blocks: %v", err)
		}
		if blockCount != 0 {
			t.Errorf("bob should not see that alice blocked him, saw %d rows", blockCount)
		}
	})
}
