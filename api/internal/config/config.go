package config

import "os"

type Config struct {
	Port              string
	DatabaseURL       string
	SupabaseJWTSecret string
}

func Load() Config {
	return Config{
		Port:              getEnv("PORT", "8080"),
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		SupabaseJWTSecret: os.Getenv("SUPABASE_JWT_SECRET"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
