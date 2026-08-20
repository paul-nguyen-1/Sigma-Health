package integrationtest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"testing"
	"time"

	"github.com/google/uuid"
)

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// TestBanEvasionPropagation is the core safety guarantee from migration
// 0007/0010: a banned phone number re-verifying under a brand-new account
// gets auto-banned too, and this must work even when the new account has
// no profiles row yet (phone verification is the FIRST onboarding step in
// the actual app -- migration 0010 exists specifically because the
// original UPDATE-only trigger silently no-op'd in exactly this case).
func TestBanEvasionPropagation(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	bannedPhone := "+15550001111"
	phoneHash := sha256Hex(bannedPhone + testPhoneHashPepper)

	priorOffender := createUser(t, pool, "PriorOffender")
	if _, err := pool.Exec(ctx,
		"INSERT INTO moderation_bans (user_id, reason, phone_number_hash, banned_at) VALUES ($1, 'seed ban', $2, now())",
		priorOffender, phoneHash,
	); err != nil {
		t.Fatalf("seed ban: %v", err)
	}

	newAccount := uuid.New()
	if _, err := pool.Exec(ctx, "INSERT INTO auth.users (id) VALUES ($1)", newAccount); err != nil {
		t.Fatalf("insert auth.users: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM auth.users WHERE id = $1", newAccount) })

	// Simulates what GoTrue does on a successful phone OTP verification.
	if _, err := pool.Exec(ctx, "UPDATE auth.users SET phone = $1, phone_confirmed_at = now() WHERE id = $2", bannedPhone, newAccount); err != nil {
		t.Fatalf("update auth.users: %v", err)
	}

	var verifiedAt *time.Time
	if err := pool.QueryRow(ctx, "SELECT phone_verified_at FROM profiles WHERE id = $1", newAccount).Scan(&verifiedAt); err != nil {
		t.Fatalf("select profiles: %v", err)
	}
	if verifiedAt == nil {
		t.Error("phone_verified_at should mirror onto profiles even with no pre-existing profile row")
	}

	var banCount int
	if err := pool.QueryRow(ctx,
		"SELECT count(*) FROM moderation_bans WHERE user_id = $1 AND lifted_at IS NULL", newAccount,
	).Scan(&banCount); err != nil {
		t.Fatalf("select moderation_bans: %v", err)
	}
	if banCount != 1 {
		t.Errorf("expected the ban to auto-propagate to the new account, got %d matching rows", banCount)
	}
}

func TestPhoneVerificationDoesNotBanCleanUsers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")

	if _, err := pool.Exec(ctx, "UPDATE auth.users SET phone = $1, phone_confirmed_at = now() WHERE id = $2", "+15559998888", alice); err != nil {
		t.Fatalf("update auth.users: %v", err)
	}

	var banCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM moderation_bans WHERE user_id = $1", alice).Scan(&banCount); err != nil {
		t.Fatalf("select: %v", err)
	}
	if banCount != 0 {
		t.Errorf("alice has a clean phone number, should have 0 ban rows, got %d", banCount)
	}
}

// TestPhoneMirrorTriggerWorksUnderRestrictedSearchPath is a direct
// regression test for the bug migration 0011 fixed: the trigger functions
// worked fine under this test suite's own (superuser, broad search_path)
// connection, but failed the moment GoTrue's connection -- which doesn't
// have public/extensions on its search_path -- fired them for real.
func TestPhoneMirrorTriggerWorksUnderRestrictedSearchPath(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	newAccount := uuid.New()
	if _, err := pool.Exec(ctx, "INSERT INTO auth.users (id) VALUES ($1)", newAccount); err != nil {
		t.Fatalf("insert auth.users: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM auth.users WHERE id = $1", newAccount) })

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SET LOCAL search_path = pg_catalog"); err != nil {
		t.Fatalf("set search_path: %v", err)
	}
	if _, err := tx.Exec(ctx,
		"UPDATE auth.users SET phone = $1, phone_confirmed_at = now() WHERE id = $2", "+15551230000", newAccount,
	); err != nil {
		t.Fatalf("trigger failed under restricted search_path (this is exactly what migration 0011 fixed): %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var verifiedAt *time.Time
	if err := pool.QueryRow(context.Background(), "SELECT phone_verified_at FROM profiles WHERE id = $1", newAccount).Scan(&verifiedAt); err != nil {
		t.Fatalf("select profiles: %v", err)
	}
	if verifiedAt == nil {
		t.Error("phone_verified_at should mirror even when the triggering connection had a restricted search_path")
	}
}
