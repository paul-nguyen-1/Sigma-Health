-- +goose Up
-- Plan templates are system-authored programs (no coach-authoring path
-- yet -- that's Phase 5). Public read for every authenticated user;
-- no client write policy at all, same as sports/gyms-directory-adjacent
-- reference data seeded below.
CREATE TABLE plan_templates (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id     uuid NOT NULL REFERENCES sports (id),
    name         text NOT NULL,
    description  text,
    created_by   uuid REFERENCES profiles (id),
    is_public    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- target is sport-specific JSONB, deliberately reusing existing shapes
-- rather than inventing a new one:
--   lifting -> {"exercises": [{"name": ..., "sets": [{"weight":0,"reps":N}]}]}
--              same shape as workouts.exercises, so a plan session can
--              seed WorkoutSessionScreen's initial state directly.
--              weight: 0 means "not prescribed, log what you use."
--   running -> {"distanceKm": N, "targetPaceSecPerKm": N|null}
CREATE TABLE plan_sessions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_template_id  uuid NOT NULL REFERENCES plan_templates (id) ON DELETE CASCADE,
    day_offset        integer NOT NULL CHECK (day_offset >= 0),
    title             text NOT NULL,
    target            jsonb NOT NULL
);
CREATE INDEX plan_sessions_template_id_idx ON plan_sessions (plan_template_id);

CREATE TABLE user_plans (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    plan_template_id  uuid NOT NULL REFERENCES plan_templates (id),
    started_at        timestamptz NOT NULL DEFAULT now(),
    status            text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'abandoned'))
);
CREATE INDEX user_plans_user_id_idx ON user_plans (user_id);

-- Rows are only ever created by the generate_user_plan_sessions trigger
-- below, never client-inserted -- so a client can't skip/duplicate/
-- fabricate scheduled sessions to game a streak. completed_at plus
-- workout_id/run_id are the one thing a client CAN write (self-only
-- UPDATE), when a session is actually completed.
CREATE TABLE user_plan_sessions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_plan_id      uuid NOT NULL REFERENCES user_plans (id) ON DELETE CASCADE,
    plan_session_id   uuid NOT NULL REFERENCES plan_sessions (id),
    scheduled_date    date NOT NULL,
    completed_at      timestamptz,
    workout_id        uuid REFERENCES workouts (id) ON DELETE SET NULL,
    run_id            uuid REFERENCES runs (id) ON DELETE SET NULL
);
CREATE INDEX user_plan_sessions_user_plan_id_idx ON user_plan_sessions (user_plan_id);
CREATE INDEX user_plan_sessions_scheduled_date_idx ON user_plan_sessions (scheduled_date);

ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_templates_select_public ON plan_templates FOR SELECT USING (is_public);

ALTER TABLE plan_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_sessions_select_via_template ON plan_sessions FOR SELECT
    USING (EXISTS (SELECT 1 FROM plan_templates t WHERE t.id = plan_template_id AND t.is_public));

ALTER TABLE user_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_plans_select_own ON user_plans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_plans_insert_own ON user_plans FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_plans_update_own ON user_plans FOR UPDATE
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE user_plan_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_plan_sessions_select_own ON user_plan_sessions FOR SELECT
    USING (EXISTS (SELECT 1 FROM user_plans p WHERE p.id = user_plan_id AND p.user_id = auth.uid()));
CREATE POLICY user_plan_sessions_update_own ON user_plan_sessions FOR UPDATE
    USING (EXISTS (SELECT 1 FROM user_plans p WHERE p.id = user_plan_id AND p.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM user_plans p WHERE p.id = user_plan_id AND p.user_id = auth.uid()));

-- +goose StatementBegin
-- SECURITY DEFINER, search_path pinned per the migration 0011 lesson --
-- this must behave identically regardless of which connection/role
-- (Go API vs. GoTrue vs. PostgREST) triggers the insert.
CREATE OR REPLACE FUNCTION generate_user_plan_sessions()
RETURNS trigger AS $$
BEGIN
    INSERT INTO user_plan_sessions (user_plan_id, plan_session_id, scheduled_date)
    SELECT NEW.id, ps.id, (NEW.started_at::date + ps.day_offset)
    FROM plan_sessions ps
    WHERE ps.plan_template_id = NEW.plan_template_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

CREATE TRIGGER user_plans_generate_sessions
    AFTER INSERT ON user_plans
    FOR EACH ROW
    EXECUTE FUNCTION generate_user_plan_sessions();

-- Seed content: one lifting template, one running template -- enough to
-- prove the loop, not a finished program (see .claude.roadmap.phase2.md
-- §5). Weights left at 0 ("not prescribed, log what you use").
INSERT INTO plan_templates (id, sport_id, name, description)
VALUES (
    '00000000-0000-0000-0000-000000000101',
    (SELECT id FROM sports WHERE slug = 'lifting'),
    'Beginner Strength',
    'A simple 3-day/week full-body strength template to start with.'
);

INSERT INTO plan_sessions (plan_template_id, day_offset, title, target) VALUES
    ('00000000-0000-0000-0000-000000000101', 0, 'Full Body A',
     '{"exercises": [{"name": "Squat", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}, {"name": "Bench Press", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}, {"name": "Row", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}]}'::jsonb),
    ('00000000-0000-0000-0000-000000000101', 2, 'Full Body B',
     '{"exercises": [{"name": "Deadlift", "sets": [{"weight": 0, "reps": 5}]}, {"name": "Overhead Press", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}, {"name": "Pull-up", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}]}'::jsonb),
    ('00000000-0000-0000-0000-000000000101', 4, 'Full Body A',
     '{"exercises": [{"name": "Squat", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}, {"name": "Bench Press", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}, {"name": "Row", "sets": [{"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}, {"weight": 0, "reps": 5}]}]}'::jsonb);

INSERT INTO plan_templates (id, sport_id, name, description)
VALUES (
    '00000000-0000-0000-0000-000000000102',
    (SELECT id FROM sports WHERE slug = 'running'),
    'Couch to 5K',
    'A run/walk progression building up to a continuous 5K.'
);

INSERT INTO plan_sessions (plan_template_id, day_offset, title, target) VALUES
    ('00000000-0000-0000-0000-000000000102', 0, 'Week 1, Run 1',
     '{"distanceKm": 2, "targetPaceSecPerKm": null}'::jsonb),
    ('00000000-0000-0000-0000-000000000102', 2, 'Week 1, Run 2',
     '{"distanceKm": 2, "targetPaceSecPerKm": null}'::jsonb),
    ('00000000-0000-0000-0000-000000000102', 4, 'Week 1, Run 3',
     '{"distanceKm": 2.5, "targetPaceSecPerKm": null}'::jsonb);

-- +goose Down
DROP TRIGGER user_plans_generate_sessions ON user_plans;
DROP FUNCTION generate_user_plan_sessions();
DROP TABLE user_plan_sessions;
DROP TABLE user_plans;
DROP TABLE plan_sessions;
DROP TABLE plan_templates;
