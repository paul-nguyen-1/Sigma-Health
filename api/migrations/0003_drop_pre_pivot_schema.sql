-- +goose Up
-- workouts/workout_sets/exercises are the single-user fitness app that
-- predates the social-fitness pivot. Zero production data exists (0 users).
-- Dropped now rather than carried forward as dead schema.
DROP TABLE workout_sets;
DROP TABLE workouts;
DROP TABLE exercises;

-- +goose Down
-- Not restoring the pre-pivot schema; if this ever needs to be undone,
-- restore from 0001_init.sql/0002_rls.sql directly.
