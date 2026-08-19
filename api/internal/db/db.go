package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool parses dsn and constructs a pool without dialing Postgres.
// pgxpool's default MinConns is 0, so no connection is established until a
// query actually acquires one — callers (like a health check) can construct
// this before the database is reachable.
//
// Every connection sets app.phone_hash_pepper for the lifetime of that
// connection: the moderation-ban enforcement trigger (see
// migrations/0007_phone_ban_triggers.sql) reads it via current_setting()
// and errors loudly if it's unset, rather than silently skipping the ban
// check.
func NewPool(ctx context.Context, dsn, phoneHashPepper string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("db: parse config: %w", err)
	}

	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SELECT set_config('app.phone_hash_pepper', $1, false)", phoneHashPepper)
		return err
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: new pool: %w", err)
	}

	return pool, nil
}
