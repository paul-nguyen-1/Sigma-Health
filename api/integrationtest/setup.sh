#!/usr/bin/env bash
# Spins up a throwaway local Postgres (never a real Supabase project),
# applies the auth-schema shim + every migration except the Supabase-only
# 0009 (needs the real Storage extension) and 0019 (needs pg_cron/pg_net),
# and prints the env var to export before running: go test ./integrationtest/...
set -euo pipefail

CONTAINER_NAME="sigma-health-rls-test"
PORT="${RLS_TEST_PORT:-55433}"
DB_URL="postgresql://postgres:postgres@localhost:${PORT}/postgres?sslmode=disable"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(dirname "$SCRIPT_DIR")"

echo "Starting throwaway Postgres container ($CONTAINER_NAME on port $PORT)..."
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER_NAME" -e POSTGRES_PASSWORD=postgres -p "${PORT}:5432" postgres:16 >/dev/null

echo "Waiting for Postgres to accept connections..."
for i in $(seq 1 30); do
  docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

echo "Applying Supabase auth-schema shim..."
docker cp "$SCRIPT_DIR/shim.sql" "$CONTAINER_NAME:/shim.sql"
docker exec -e PGPASSWORD=postgres "$CONTAINER_NAME" psql -U postgres -f /shim.sql >/dev/null

echo "Applying migrations (excluding 0009 and 0019, Supabase-only)..."
TMP_DIR="$(mktemp -d)"
mkdir -p "$TMP_DIR/migrations"
cp "$API_DIR"/migrations/*.sql "$TMP_DIR/migrations/"
rm -f "$TMP_DIR/migrations/0009_avatars_storage.sql"
rm -f "$TMP_DIR/migrations/0019_streak_nudges.sql"
# goose resolves its migrations dir relative to the process's cwd at
# runtime, but `go run` needs to be invoked from inside the module -- so
# build the binary first (module context), then run it from TMP_DIR
# (migrations-dir context).
(cd "$API_DIR" && go build -o "$TMP_DIR/migrate" ./cmd/migrate)
(cd "$TMP_DIR" && DATABASE_URL="$DB_URL" ./migrate up)
rm -rf "$TMP_DIR"

echo ""
echo "Ready. Run the suite with:"
echo ""
echo "  RLS_TEST_DATABASE_URL=\"$DB_URL\" go test ./integrationtest/... -v"
echo ""
echo "Tear down when done with: docker rm -f $CONTAINER_NAME"
