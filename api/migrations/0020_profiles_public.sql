-- +goose Up
-- profiles stays self-only (0008) since it holds phone_number/
-- expo_push_token -- a permissive USING(true) policy on the table
-- itself would leak those. Every Phase 3 surface (match participant
-- names, conversation members, group rosters, location-channel
-- rosters, follower/following lists) needs another user's basic
-- identity, so a view exposing only the safe columns is the read path
-- instead. Created without security_invoker, so it runs as its owner
-- (bypasses RLS internally) and returns every profile's safe columns
-- to any authenticated caller -- profiles itself, queried directly,
-- is completely unaffected. See .claude.roadmap.phase3.md §0 Case 2.
CREATE VIEW profiles_public AS
    SELECT id, display_name, avatar_url, bio, home_gym_id, home_park_id
    FROM profiles;
GRANT SELECT ON profiles_public TO authenticated;

-- +goose Down
DROP VIEW profiles_public;
