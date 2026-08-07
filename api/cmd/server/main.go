package main

import (
	"context"
	"log"

	"github.com/gofiber/fiber/v2"

	"sigma-health-api/internal/config"
	"sigma-health-api/internal/db"
	"sigma-health-api/internal/handlers"
	"sigma-health-api/internal/middleware"
)

func main() {
	cfg := config.Load()

	pool, err := db.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	app := fiber.New()

	app.Get("/health", handlers.Health)
	app.Get("/me", middleware.RequireAuth(cfg.SupabaseJWTSecret), handlers.Me)

	log.Fatal(app.Listen(":" + cfg.Port))
}
