package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool parses dsn and constructs a pool without dialing Postgres.
// pgxpool's default MinConns is 0, so no connection is established until a
// query actually acquires one — callers (like a health check) can construct
// this before the database is reachable.
func NewPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("db: parse config: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: new pool: %w", err)
	}

	return pool, nil
}
