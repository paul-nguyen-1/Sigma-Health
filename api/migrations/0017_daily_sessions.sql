-- +goose Up
-- One shared "session of the day" per sport, system-authored, public
-- read, opt-in -- separate from a user's personal plan. No per-user
-- completion table: "did I do it" is inferred from whether a logged
-- workout/run happens to reference this row (see the FK columns below),
-- a simplicity bet documented in .claude.roadmap.phase2.md §8.
CREATE TABLE daily_sessions (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id  uuid NOT NULL REFERENCES sports (id),
    date      date NOT NULL,
    title     text NOT NULL,
    target    jsonb NOT NULL,
    UNIQUE (sport_id, date)
);

ALTER TABLE daily_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_sessions_select_all ON daily_sessions FOR SELECT USING (true);

ALTER TABLE workouts ADD COLUMN daily_session_id uuid REFERENCES daily_sessions (id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN daily_session_id uuid REFERENCES daily_sessions (id) ON DELETE SET NULL;

-- +goose Down
ALTER TABLE runs DROP COLUMN daily_session_id;
ALTER TABLE workouts DROP COLUMN daily_session_id;
DROP TABLE daily_sessions;
