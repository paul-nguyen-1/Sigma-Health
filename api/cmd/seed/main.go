package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

// seed upserts a JSON file of gyms/parks into the database. Used for local
// dev seeding and, unchanged, for seeding the real gyms/clubs the GTM
// motion lines up before pilot launch (see .claude.roadmap.phase1.md §5).
type seedLocation struct {
	Sport   string  `json:"sport"`
	Name    string  `json:"name"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Address string  `json:"address,omitempty"`
}

type seedFile struct {
	Gyms  []seedLocation `json:"gyms"`
	Parks []seedLocation `json:"parks"`
}

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: seed <path-to-seed.json>")
	}

	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		log.Fatal(err)
	}

	var seed seedFile
	if err := json.Unmarshal(data, &seed); err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	for _, g := range seed.Gyms {
		if err := seedGym(ctx, pool, g); err != nil {
			log.Fatalf("seed gym %q: %v", g.Name, err)
		}
	}
	for _, p := range seed.Parks {
		if err := seedPark(ctx, pool, p); err != nil {
			log.Fatalf("seed park %q: %v", p.Name, err)
		}
	}

	fmt.Printf("seeded %d gyms, %d parks\n", len(seed.Gyms), len(seed.Parks))
}

func seedGym(ctx context.Context, pool *pgxpool.Pool, loc seedLocation) error {
	sportID, err := lookupSportID(ctx, pool, loc.Sport)
	if err != nil {
		return err
	}

	var exists bool
	if err := pool.QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM gyms WHERE sport_id = $1 AND name = $2)",
		sportID, loc.Name,
	).Scan(&exists); err != nil {
		return fmt.Errorf("check existing: %w", err)
	}
	if exists {
		return nil
	}

	_, err = pool.Exec(ctx,
		"INSERT INTO gyms (sport_id, name, lat, lng, address) VALUES ($1, $2, $3, $4, $5)",
		sportID, loc.Name, loc.Lat, loc.Lng, loc.Address,
	)
	return err
}

func seedPark(ctx context.Context, pool *pgxpool.Pool, loc seedLocation) error {
	sportID, err := lookupSportID(ctx, pool, loc.Sport)
	if err != nil {
		return err
	}

	var exists bool
	if err := pool.QueryRow(ctx,
		"SELECT EXISTS (SELECT 1 FROM parks WHERE sport_id = $1 AND name = $2)",
		sportID, loc.Name,
	).Scan(&exists); err != nil {
		return fmt.Errorf("check existing: %w", err)
	}
	if exists {
		return nil
	}

	_, err = pool.Exec(ctx,
		"INSERT INTO parks (sport_id, name, lat, lng) VALUES ($1, $2, $3, $4)",
		sportID, loc.Name, loc.Lat, loc.Lng,
	)
	return err
}

func lookupSportID(ctx context.Context, pool *pgxpool.Pool, slug string) (string, error) {
	var id string
	if err := pool.QueryRow(ctx, "SELECT id FROM sports WHERE slug = $1", slug).Scan(&id); err != nil {
		return "", fmt.Errorf("lookup sport %q: %w", slug, err)
	}
	return id, nil
}
