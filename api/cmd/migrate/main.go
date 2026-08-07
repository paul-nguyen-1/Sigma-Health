package main

import (
	"context"
	"database/sql"
	"log"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatal(err)
	}

	cmd := "up"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	if err := goose.RunContext(context.Background(), cmd, db, "migrations"); err != nil {
		log.Fatal(err)
	}
}
