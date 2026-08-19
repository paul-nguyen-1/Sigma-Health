-- +goose Up
-- moderation_bans: RLS enabled with zero policies == the `authenticated`
-- role gets zero rows on any query and cannot write. Only SECURITY DEFINER
-- trigger functions (see 0007) and a future service-role admin tool can
-- touch this table.
ALTER TABLE moderation_bans ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select_own ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_insert_own ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

ALTER TABLE user_sports ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_sports_select_own ON user_sports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_sports_insert_own ON user_sports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_sports_delete_own ON user_sports FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
CREATE POLICY sports_select_all ON sports FOR SELECT USING (true);

ALTER TABLE gyms ENABLE ROW LEVEL SECURITY;
CREATE POLICY gyms_select_all ON gyms FOR SELECT USING (true);
CREATE POLICY gyms_insert_authenticated ON gyms FOR INSERT WITH CHECK (auth.uid() = submitted_by);

ALTER TABLE parks ENABLE ROW LEVEL SECURITY;
CREATE POLICY parks_select_all ON parks FOR SELECT USING (true);
CREATE POLICY parks_insert_authenticated ON parks FOR INSERT WITH CHECK (auth.uid() = submitted_by);

ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY check_ins_select_own ON check_ins FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY check_ins_insert_own ON check_ins FOR INSERT WITH CHECK (auth.uid() = user_id);
-- No update/delete policy: a check-in is an immutable event, it just expires.

ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY personal_records_select_own ON personal_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY personal_records_insert_own ON personal_records FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY runs_select_own ON runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY runs_insert_own ON runs FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_insert_own ON reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);
CREATE POLICY reports_select_own ON reports FOR SELECT USING (auth.uid() = reporter_id);
-- No policy lets a user see reports filed against them.

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY blocks_select_own ON blocks FOR SELECT USING (auth.uid() = blocker_id);
CREATE POLICY blocks_insert_own ON blocks FOR INSERT WITH CHECK (auth.uid() = blocker_id);
CREATE POLICY blocks_delete_own ON blocks FOR DELETE USING (auth.uid() = blocker_id);

-- +goose Down
ALTER TABLE blocks DISABLE ROW LEVEL SECURITY;
DROP POLICY blocks_delete_own ON blocks;
DROP POLICY blocks_insert_own ON blocks;
DROP POLICY blocks_select_own ON blocks;

ALTER TABLE reports DISABLE ROW LEVEL SECURITY;
DROP POLICY reports_select_own ON reports;
DROP POLICY reports_insert_own ON reports;

ALTER TABLE runs DISABLE ROW LEVEL SECURITY;
DROP POLICY runs_insert_own ON runs;
DROP POLICY runs_select_own ON runs;

ALTER TABLE personal_records DISABLE ROW LEVEL SECURITY;
DROP POLICY personal_records_insert_own ON personal_records;
DROP POLICY personal_records_select_own ON personal_records;

ALTER TABLE check_ins DISABLE ROW LEVEL SECURITY;
DROP POLICY check_ins_insert_own ON check_ins;
DROP POLICY check_ins_select_own ON check_ins;

ALTER TABLE parks DISABLE ROW LEVEL SECURITY;
DROP POLICY parks_insert_authenticated ON parks;
DROP POLICY parks_select_all ON parks;

ALTER TABLE gyms DISABLE ROW LEVEL SECURITY;
DROP POLICY gyms_insert_authenticated ON gyms;
DROP POLICY gyms_select_all ON gyms;

ALTER TABLE sports DISABLE ROW LEVEL SECURITY;
DROP POLICY sports_select_all ON sports;

ALTER TABLE user_sports DISABLE ROW LEVEL SECURITY;
DROP POLICY user_sports_delete_own ON user_sports;
DROP POLICY user_sports_insert_own ON user_sports;
DROP POLICY user_sports_select_own ON user_sports;

ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
DROP POLICY profiles_insert_own ON profiles;
DROP POLICY profiles_update_own ON profiles;
DROP POLICY profiles_select_own ON profiles;

ALTER TABLE moderation_bans DISABLE ROW LEVEL SECURITY;
