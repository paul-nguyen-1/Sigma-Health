-- +goose Up
-- The single highest-regression-risk migration in this phase: the
-- first time this codebase retroactively widens an existing Phase 1/2
-- RLS policy rather than only adding new ones. Kept as its own
-- migration, separate from follows' own creation (0023), specifically
-- so it has its own dedicated rollback path. Deliberately does NOT
-- touch workouts -- personal_records/runs are already "worth showing
-- someone else" events by construction (a new best, a discrete
-- summarizable run); a raw multi-exercise session log is noise, not
-- signal. See phase3.md §0 Case 7.
DROP POLICY personal_records_select_own ON personal_records;
CREATE POLICY personal_records_select_self_or_followed ON personal_records FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM follows WHERE follower_id = auth.uid() AND followed_id = personal_records.user_id)
);

DROP POLICY runs_select_own ON runs;
CREATE POLICY runs_select_self_or_followed ON runs FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM follows WHERE follower_id = auth.uid() AND followed_id = runs.user_id)
);

-- +goose Down
DROP POLICY runs_select_self_or_followed ON runs;
CREATE POLICY runs_select_own ON runs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY personal_records_select_self_or_followed ON personal_records;
CREATE POLICY personal_records_select_own ON personal_records FOR SELECT USING (auth.uid() = user_id);
