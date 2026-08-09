-- +goose Up
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY workouts_select_own ON workouts
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY workouts_insert_own ON workouts
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY workouts_update_own ON workouts
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY workouts_delete_own ON workouts
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY workout_sets_select_own ON workout_sets
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM workouts w WHERE w.id = workout_sets.workout_id AND w.user_id = auth.uid())
    );
CREATE POLICY workout_sets_insert_own ON workout_sets
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM workouts w WHERE w.id = workout_sets.workout_id AND w.user_id = auth.uid())
    );
CREATE POLICY workout_sets_update_own ON workout_sets
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM workouts w WHERE w.id = workout_sets.workout_id AND w.user_id = auth.uid())
    ) WITH CHECK (
        EXISTS (SELECT 1 FROM workouts w WHERE w.id = workout_sets.workout_id AND w.user_id = auth.uid())
    );
CREATE POLICY workout_sets_delete_own ON workout_sets
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM workouts w WHERE w.id = workout_sets.workout_id AND w.user_id = auth.uid())
    );

-- +goose Down
DROP POLICY workout_sets_delete_own ON workout_sets;
DROP POLICY workout_sets_update_own ON workout_sets;
DROP POLICY workout_sets_insert_own ON workout_sets;
DROP POLICY workout_sets_select_own ON workout_sets;
DROP POLICY workouts_delete_own ON workouts;
DROP POLICY workouts_update_own ON workouts;
DROP POLICY workouts_insert_own ON workouts;
DROP POLICY workouts_select_own ON workouts;
ALTER TABLE workout_sets DISABLE ROW LEVEL SECURITY;
ALTER TABLE workouts DISABLE ROW LEVEL SECURITY;
