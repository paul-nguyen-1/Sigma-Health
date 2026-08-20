-- +goose Up
-- Personal records are a derived, quick-lookup summary of a user's best
-- set per exercise -- NOT another place to manually log data. Maintained
-- entirely by a trigger off workouts.exercises, so it can't drift from
-- what was actually logged and can't be faked/inflated by a direct
-- client write (no INSERT/UPDATE/DELETE grant to authenticated at all,
-- only SELECT -- same "server-authoritative" shape as moderation_bans,
-- just readable instead of fully locked).
CREATE TABLE personal_records (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    exercise_name  text NOT NULL, -- normalized (trim + lowercase) so "Bench Press"
                                   -- and "bench press" are the same PR, not two
    best_weight    numeric NOT NULL CHECK (best_weight > 0),
    best_reps      integer NOT NULL CHECK (best_reps > 0),
    best_1rm       numeric GENERATED ALWAYS AS (best_weight * (1 + best_reps::numeric / 30)) STORED,
    workout_id     uuid REFERENCES workouts (id) ON DELETE SET NULL,
    achieved_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, exercise_name)
);
CREATE INDEX personal_records_user_id_idx ON personal_records (user_id);

ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_records_select_own ON personal_records FOR SELECT USING (auth.uid() = user_id);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION sync_personal_records()
RETURNS trigger AS $$
DECLARE
    exercise      jsonb;
    set_entry     jsonb;
    ex_name       text;
    set_weight    numeric;
    set_reps      integer;
    set_1rm       numeric;
    existing_1rm  numeric;
BEGIN
    FOR exercise IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.exercises, '[]'::jsonb))
    LOOP
        ex_name := lower(trim(exercise->>'name'));
        IF ex_name IS NULL OR ex_name = '' THEN
            CONTINUE;
        END IF;

        FOR set_entry IN SELECT * FROM jsonb_array_elements(COALESCE(exercise->'sets', '[]'::jsonb))
        LOOP
            set_weight := NULLIF(set_entry->>'weight', '')::numeric;
            set_reps := NULLIF(set_entry->>'reps', '')::integer;
            IF set_weight IS NULL OR set_reps IS NULL OR set_weight <= 0 OR set_reps <= 0 THEN
                CONTINUE;
            END IF;
            set_1rm := set_weight * (1 + set_reps::numeric / 30);

            SELECT best_1rm INTO existing_1rm
            FROM personal_records
            WHERE user_id = NEW.user_id AND exercise_name = ex_name;

            IF existing_1rm IS NULL OR set_1rm > existing_1rm THEN
                INSERT INTO personal_records (user_id, exercise_name, best_weight, best_reps, workout_id, achieved_at)
                VALUES (NEW.user_id, ex_name, set_weight, set_reps, NEW.id, now())
                ON CONFLICT (user_id, exercise_name) DO UPDATE
                SET best_weight = EXCLUDED.best_weight,
                    best_reps = EXCLUDED.best_reps,
                    workout_id = EXCLUDED.workout_id,
                    achieved_at = now();
                -- so a second, better set later in the SAME save is
                -- compared against this one, not the stale pre-save PR
                existing_1rm := set_1rm;
            END IF;
        END LOOP;
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

CREATE TRIGGER workouts_sync_personal_records
    AFTER INSERT OR UPDATE OF exercises ON workouts
    FOR EACH ROW
    EXECUTE FUNCTION sync_personal_records();

-- +goose Down
DROP TRIGGER workouts_sync_personal_records ON workouts;
DROP FUNCTION sync_personal_records();
DROP TABLE personal_records;
