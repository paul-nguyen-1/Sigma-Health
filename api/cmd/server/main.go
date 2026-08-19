package main

import (
	"context"
	"log"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gofiber/fiber/v2"

	"sigma-health-api/internal/config"
	"sigma-health-api/internal/db"
	"sigma-health-api/internal/handlers"
	"sigma-health-api/internal/middleware"
)

func main() {
	cfg := config.Load()

	if cfg.PhoneHashPepper == "" {
		log.Fatal("PHONE_HASH_PEPPER must be set — the moderation-ban trigger depends on it")
	}

	pool, err := db.NewPool(context.Background(), cfg.DatabaseURL, cfg.PhoneHashPepper)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	kf, err := keyfunc.NewDefaultCtx(context.Background(), []string{cfg.SupabaseJWKSURL})
	if err != nil {
		log.Fatal(err)
	}

	app := fiber.New()

	app.Get("/health", handlers.Health)
	app.Get("/me", middleware.RequireAuth(kf), handlers.Me(pool))

	log.Fatal(app.Listen(":" + cfg.Port))
}
