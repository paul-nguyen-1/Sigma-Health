package config

import "os"

type Config struct {
	Port            string
	DatabaseURL     string
	SupabaseJWKSURL string
	PhoneHashPepper string
}

func Load() Config {
	return Config{
		Port:            getEnv("PORT", "8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		SupabaseJWKSURL: os.Getenv("SUPABASE_JWKS_URL"),
		PhoneHashPepper: os.Getenv("PHONE_HASH_PEPPER"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
