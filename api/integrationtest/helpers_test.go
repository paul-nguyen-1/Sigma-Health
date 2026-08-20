// Package integrationtest holds RLS/schema tests that need a real
// Postgres instance with the Supabase auth-schema shim applied -- see
// setup.sh. These are skipped automatically (not failed) when
// RLS_TEST_DATABASE_URL isn't set, so `go test ./...` in CI (which has no
// database) stays green; run these explicitly and locally instead.
package integrationtest

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const testPhoneHashPepper = "integration-test-pepper"

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("RLS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("RLS_TEST_DATABASE_URL not set -- run ./setup.sh first, then export the printed value")
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SELECT set_config('app.phone_hash_pepper', $1, false)", testPhoneHashPepper)
		return err
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// createUser inserts a fresh auth.users + profiles row, run as the pool's
// own (superuser) connection so it bypasses RLS, and registers cleanup.
func createUser(t *testing.T, pool *pgxpool.Pool, displayName string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	id := uuid.New()

	if _, err := pool.Exec(ctx, "INSERT INTO auth.users (id) VALUES ($1)", id); err != nil {
		t.Fatalf("insert auth.users: %v", err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO profiles (id, display_name) VALUES ($1, $2)", id, displayName); err != nil {
		t.Fatalf("insert profiles: %v", err)
	}

	t.Cleanup(func() {
		// Cascades to everything owned by this user -- migration 0012.
		_, _ = pool.Exec(context.Background(), "DELETE FROM auth.users WHERE id = $1", id)
	})

	return id
}

// asUser runs fn inside a transaction impersonating userID as the
// `authenticated` role -- the same role/auth.uid() combination Supabase's
// PostgREST uses when evaluating RLS for a real request. Always rolls
// back afterward, so run assertions on the effects (row counts, errors)
// inside fn using tx, not by checking from outside afterward.
func asUser(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, fn func(tx pgx.Tx)) {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SET LOCAL ROLE authenticated"); err != nil {
		t.Fatalf("set role: %v", err)
	}
	if _, err := tx.Exec(ctx, "SELECT set_config('request.jwt.claim.sub', $1, true)", userID.String()); err != nil {
		t.Fatalf("set jwt sub: %v", err)
	}

	fn(tx)
}
