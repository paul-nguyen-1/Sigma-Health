-- +goose Up
-- Intentionally unilateral -- no accept/decline, unlike match_participants
-- above. Following someone grants no new access beyond what 0024's
-- widened personal_records/runs SELECT already makes public to
-- followers; there's no consent-to-message concern here the way there
-- is with a DM opening. See phase3.md §0 Case 7.
CREATE TABLE follows (
    follower_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    followed_id  uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followed_id),
    CONSTRAINT follows_no_self_follow CHECK (follower_id <> followed_id)
);

ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
-- Follower/following lists are public -- "profile becomes the full
-- record" -- matching sports/gyms/daily_sessions' public-read shape.
CREATE POLICY follows_select_all ON follows FOR SELECT USING (true);
-- is_blocked (0021) is required here, not a raw EXISTS against blocks --
-- blocks' own self-only RLS would otherwise hide a block from the
-- blocked party's side of this very check. See phase3.md and 0021's
-- comment on is_blocked for the full explanation (confirmed directly
-- during Week 1 verification).
CREATE POLICY follows_insert_own ON follows FOR INSERT WITH CHECK (
    follower_id = auth.uid()
    AND NOT is_blocked(follower_id, followed_id)
);
CREATE POLICY follows_delete_own ON follows FOR DELETE USING (follower_id = auth.uid());

-- +goose Down
DROP TABLE follows;
