package integrationtest

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// TestUserDeleteCascades is a regression test for migration 0012: none of
// the FKs into auth.users/profiles specified ON DELETE behavior
// originally, so deleting a user (e.g. via the Supabase dashboard) failed
// outright the moment a profiles row existed. Also verifies the
// deliberate exception: a ban record survives the banned user being
// deleted, with user_id set NULL rather than cascading away.
func TestUserDeleteCascades(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	dana := createUser(t, pool, "Dana")

	if _, err := pool.Exec(ctx,
		"INSERT INTO workouts (user_id, title, exercises) VALUES ($1, 'Leg Day', '[]'::jsonb)", dana,
	); err != nil {
		t.Fatalf("insert workouts: %v", err)
	}
	if _, err := pool.Exec(ctx,
		"INSERT INTO moderation_bans (user_id, reason, phone_number_hash, banned_at) VALUES ($1, 'test ban', 'abc123', now())", dana,
	); err != nil {
		t.Fatalf("insert moderation_bans: %v", err)
	}

	if _, err := pool.Exec(ctx, "DELETE FROM auth.users WHERE id = $1", dana); err != nil {
		t.Fatalf("deleting a user should succeed (this is exactly what migration 0012 fixed): %v", err)
	}

	var profileCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM profiles WHERE id = $1", dana).Scan(&profileCount); err != nil {
		t.Fatalf("select profiles: %v", err)
	}
	if profileCount != 0 {
		t.Errorf("profile should be gone after the cascading delete, found %d", profileCount)
	}

	var banCount int
	var banUserID *uuid.UUID
	if err := pool.QueryRow(ctx,
		"SELECT count(*), (array_agg(user_id))[1] FROM moderation_bans WHERE reason = 'test ban'",
	).Scan(&banCount, &banUserID); err != nil {
		t.Fatalf("select moderation_bans: %v", err)
	}
	if banCount != 1 {
		t.Errorf("ban record should survive user deletion, found %d", banCount)
	}
	if banUserID != nil {
		t.Errorf("ban.user_id should be set NULL after the user is deleted, got %v", *banUserID)
	}
}
