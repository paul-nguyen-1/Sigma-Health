package integrationtest

import (
	"context"
	"math"
	"testing"
)

// 1RM is no longer a DB-generated column -- workouts (migration 0014)
// replaced the one-row-per-lift personal_records model with one row per
// session, so 1RM per set is computed client-side (Epley formula) from
// the exercises JSONB instead of being stored. Nothing to test at the DB
// layer for it anymore.

func TestRunPaceAndDistanceBucket(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")

	tests := []struct {
		name       string
		distanceKm float64
		wantBucket string // "" means expect NULL
	}{
		{"within 5k tolerance", 5.02, "5k"},
		{"within 10k tolerance", 9.9, "10k"},
		{"within half marathon tolerance", 21.2, "half_marathon"},
		{"within marathon tolerance", 42.0, "marathon"},
		{"between buckets", 6.3, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var bucket *string
			err := pool.QueryRow(ctx,
				"INSERT INTO runs (user_id, distance_km, duration_seconds) VALUES ($1, $2, 1500) RETURNING distance_bucket",
				alice, tt.distanceKm,
			).Scan(&bucket)
			if err != nil {
				t.Fatalf("insert: %v", err)
			}
			got := ""
			if bucket != nil {
				got = *bucket
			}
			if got != tt.wantBucket {
				t.Errorf("distance_bucket = %q, want %q", got, tt.wantBucket)
			}
		})
	}

	var pace float64
	err := pool.QueryRow(ctx,
		"INSERT INTO runs (user_id, distance_km, duration_seconds) VALUES ($1, 5.0, 1500) RETURNING pace_seconds_per_km",
		alice,
	).Scan(&pace)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if math.Abs(pace-300) > 0.001 {
		t.Errorf("pace_seconds_per_km = %v, want 300 (1500s / 5km)", pace)
	}
}
