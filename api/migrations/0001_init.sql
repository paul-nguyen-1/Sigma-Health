-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE exercises (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    muscle_groups      text[] NOT NULL DEFAULT '{}',
    instructional_url  text
);

CREATE TABLE workouts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users (id),
    started_at  timestamptz NOT NULL DEFAULT now(),
    notes       text
);

CREATE TABLE workout_sets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workout_id   uuid NOT NULL REFERENCES workouts (id),
    exercise_id  uuid NOT NULL REFERENCES exercises (id),
    reps         integer NOT NULL,
    weight       numeric NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE workout_sets;
DROP TABLE workouts;
DROP TABLE exercises;
