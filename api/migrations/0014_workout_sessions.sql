-- +goose Up
-- Replaces the one-row-per-lift personal_records model with one row per
-- workout session (title + a JSONB list of exercises, each with its own
-- sets). Matches how people actually train (a session with several
-- exercises) rather than isolated lift entries, and is directly
-- editable -- update the exercises JSONB rather than needing to touch
-- several rows. calculated_1rm was a generated column tied to the old
-- one-row-per-lift shape; 1RM per set is now computed client-side
-- (Epley formula) from exercises JSONB, not stored.
DROP TABLE personal_records;

CREATE TABLE workouts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    gym_id      uuid REFERENCES gyms (id) ON DELETE SET NULL,
    title       text NOT NULL,
    exercises   jsonb NOT NULL DEFAULT '[]',
    started_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workouts_user_id_idx ON workouts (user_id);

ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY workouts_select_own ON workouts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY workouts_insert_own ON workouts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY workouts_update_own ON workouts FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY workouts_delete_own ON workouts FOR DELETE USING (auth.uid() = user_id);

-- +goose Down
DROP TABLE workouts;

CREATE TABLE personal_records (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    gym_id                uuid REFERENCES gyms (id),
    lift_name             text NOT NULL,
    weight                numeric NOT NULL CHECK (weight > 0),
    reps                  integer NOT NULL CHECK (reps > 0),
    calculated_1rm        numeric GENERATED ALWAYS AS (weight * (1 + reps::numeric / 30)) STORED,
    video_storage_path    text,
    verification_status   text NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'flagged')),
    created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personal_records_user_id_idx ON personal_records (user_id);
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_records_select_own ON personal_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY personal_records_insert_own ON personal_records FOR INSERT WITH CHECK (auth.uid() = user_id);
