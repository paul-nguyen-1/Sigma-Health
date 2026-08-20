package integrationtest

import (
	"context"
	"math"
	"testing"
)

func TestCalculated1RM(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")

	var oneRM float64
	err := pool.QueryRow(ctx,
		"INSERT INTO personal_records (user_id, lift_name, weight, reps) VALUES ($1, 'bench', 100, 5) RETURNING calculated_1rm",
		alice,
	).Scan(&oneRM)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	want := 100 * (1 + 5.0/30) // Epley formula
	if math.Abs(oneRM-want) > 0.001 {
		t.Errorf("calculated_1rm = %v, want %v", oneRM, want)
	}
}

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
