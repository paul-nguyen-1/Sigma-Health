-- +goose Up
-- None of the FKs into auth.users/profiles specified ON DELETE behavior,
-- so Postgres defaulted to NO ACTION -- deleting a user via the Supabase
-- dashboard (or admin API) fails with a foreign key violation the moment
-- a profiles row exists, which it always does post-onboarding. Found by
-- actually trying to delete a test user, not by inspection.
--
-- moderation_bans is deliberately NOT cascaded to delete: the whole point
-- of a ban is that phone_number_hash survives to catch ban-evasion
-- re-signups, even if the original account is later deleted (by an admin,
-- or eventually a user-initiated account deletion). user_id/banned_by go
-- to SET NULL instead, so the ban record and its hash persist.
ALTER TABLE profiles DROP CONSTRAINT profiles_id_fkey;
ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE gyms DROP CONSTRAINT gyms_submitted_by_fkey;
ALTER TABLE gyms ADD CONSTRAINT gyms_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE parks DROP CONSTRAINT parks_submitted_by_fkey;
ALTER TABLE parks ADD CONSTRAINT parks_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE user_sports DROP CONSTRAINT user_sports_user_id_fkey;
ALTER TABLE user_sports ADD CONSTRAINT user_sports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;

ALTER TABLE check_ins DROP CONSTRAINT check_ins_user_id_fkey;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;

ALTER TABLE personal_records DROP CONSTRAINT personal_records_user_id_fkey;
ALTER TABLE personal_records ADD CONSTRAINT personal_records_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;

ALTER TABLE runs DROP CONSTRAINT runs_user_id_fkey;
ALTER TABLE runs ADD CONSTRAINT runs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE;

ALTER TABLE moderation_bans ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE moderation_bans DROP CONSTRAINT moderation_bans_user_id_fkey;
ALTER TABLE moderation_bans ADD CONSTRAINT moderation_bans_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE SET NULL;
ALTER TABLE moderation_bans DROP CONSTRAINT moderation_bans_banned_by_fkey;
ALTER TABLE moderation_bans ADD CONSTRAINT moderation_bans_banned_by_fkey
    FOREIGN KEY (banned_by) REFERENCES profiles (id) ON DELETE SET NULL;

-- reports/blocks: simplest correct choice for now (no admin review
-- workflow exists yet to need these to outlive either party) -- CASCADE
-- on both sides. Revisit if/when Phase 4/5 admin tooling wants report
-- history to survive a reporter's account deletion.
ALTER TABLE reports DROP CONSTRAINT reports_reporter_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE reports DROP CONSTRAINT reports_reported_user_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reported_user_id_fkey
    FOREIGN KEY (reported_user_id) REFERENCES profiles (id) ON DELETE CASCADE;

ALTER TABLE blocks DROP CONSTRAINT blocks_blocker_id_fkey;
ALTER TABLE blocks ADD CONSTRAINT blocks_blocker_id_fkey
    FOREIGN KEY (blocker_id) REFERENCES profiles (id) ON DELETE CASCADE;
ALTER TABLE blocks DROP CONSTRAINT blocks_blocked_id_fkey;
ALTER TABLE blocks ADD CONSTRAINT blocks_blocked_id_fkey
    FOREIGN KEY (blocked_id) REFERENCES profiles (id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE blocks DROP CONSTRAINT blocks_blocked_id_fkey;
ALTER TABLE blocks ADD CONSTRAINT blocks_blocked_id_fkey
    FOREIGN KEY (blocked_id) REFERENCES profiles (id);
ALTER TABLE blocks DROP CONSTRAINT blocks_blocker_id_fkey;
ALTER TABLE blocks ADD CONSTRAINT blocks_blocker_id_fkey
    FOREIGN KEY (blocker_id) REFERENCES profiles (id);

ALTER TABLE reports DROP CONSTRAINT reports_reported_user_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reported_user_id_fkey
    FOREIGN KEY (reported_user_id) REFERENCES profiles (id);
ALTER TABLE reports DROP CONSTRAINT reports_reporter_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES profiles (id);

ALTER TABLE moderation_bans DROP CONSTRAINT moderation_bans_banned_by_fkey;
ALTER TABLE moderation_bans ADD CONSTRAINT moderation_bans_banned_by_fkey
    FOREIGN KEY (banned_by) REFERENCES profiles (id);
ALTER TABLE moderation_bans DROP CONSTRAINT moderation_bans_user_id_fkey;
ALTER TABLE moderation_bans ADD CONSTRAINT moderation_bans_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id);
ALTER TABLE moderation_bans ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE runs DROP CONSTRAINT runs_user_id_fkey;
ALTER TABLE runs ADD CONSTRAINT runs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id);

ALTER TABLE personal_records DROP CONSTRAINT personal_records_user_id_fkey;
ALTER TABLE personal_records ADD CONSTRAINT personal_records_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id);

ALTER TABLE check_ins DROP CONSTRAINT check_ins_user_id_fkey;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id);

ALTER TABLE user_sports DROP CONSTRAINT user_sports_user_id_fkey;
ALTER TABLE user_sports ADD CONSTRAINT user_sports_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles (id);

ALTER TABLE parks DROP CONSTRAINT parks_submitted_by_fkey;
ALTER TABLE parks ADD CONSTRAINT parks_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES auth.users (id);

ALTER TABLE gyms DROP CONSTRAINT gyms_submitted_by_fkey;
ALTER TABLE gyms ADD CONSTRAINT gyms_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES auth.users (id);

ALTER TABLE profiles DROP CONSTRAINT profiles_id_fkey;
ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users (id);
