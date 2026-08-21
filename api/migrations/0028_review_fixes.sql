-- +goose Up
-- Fixes from a full code-review pass across all of Phase 3 (0020-0027),
-- once the mobile UI existed to actually exercise the schema end to end.
-- Grouped in one migration since they were all found together as one
-- review, not seven unrelated changes -- see .claude.roadmap.phase3.md
-- Status for the individual write-ups.

-- Fix 1: messages_insert's group branch never called is_blocked, unlike
-- the direct branch three lines below it in 0021 -- two blocked members
-- of the same group (including a match-provisioned one) could still
-- message each other. Unify direct/group onto one block-checked branch
-- instead of the group branch skipping the check entirely.
DROP POLICY messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = conversation_id
          AND (
            (c.type IN ('group', 'direct') AND is_conversation_member(c.id, auth.uid()) AND NOT EXISTS (
                SELECT 1 FROM conversation_members other
                WHERE other.conversation_id = c.id AND other.user_id <> auth.uid()
                  AND is_blocked(auth.uid(), other.user_id)
            ))
            OR (c.type = 'location' AND EXISTS (
                SELECT 1 FROM check_ins ci
                WHERE ci.location_type = c.location_type AND ci.location_id = c.location_id
                  AND ci.user_id = auth.uid() AND ci.expires_at > now()
            ))
          )
    )
);

-- Fix 2: propose_match's "join an existing open group" lookup (0022) had
-- no block check at all, unlike the invite-candidate query 15 lines
-- below it -- a user could be auto-joined into a match with someone who
-- blocked them. search_path pinned per the migration 0011 lesson,
-- unchanged from 0022's original.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION propose_match(p_park_id uuid, p_pace_bucket text)
RETURNS uuid AS $$
DECLARE
    v_running_sport_id uuid;
    v_group_id          uuid;
BEGIN
    SELECT id INTO v_running_sport_id FROM sports WHERE slug = 'running';

    SELECT id INTO v_group_id FROM match_groups
    WHERE park_id = p_park_id AND pace_bucket = p_pace_bucket AND status = 'open'
      AND NOT EXISTS (SELECT 1 FROM match_participants mp WHERE mp.match_group_id = match_groups.id AND mp.user_id = auth.uid())
      AND NOT EXISTS (
          SELECT 1 FROM match_participants mp
          WHERE mp.match_group_id = match_groups.id AND is_blocked(auth.uid(), mp.user_id)
      )
    LIMIT 1;

    IF v_group_id IS NULL THEN
        INSERT INTO match_groups (sport_id, park_id, pace_bucket)
        VALUES (v_running_sport_id, p_park_id, p_pace_bucket)
        RETURNING id INTO v_group_id;
    END IF;

    INSERT INTO match_participants (match_group_id, user_id, status, responded_at)
    VALUES (v_group_id, auth.uid(), 'accepted', now())
    ON CONFLICT (match_group_id, user_id) DO NOTHING;

    INSERT INTO match_participants (match_group_id, user_id, status)
    SELECT v_group_id, r.user_id, 'invited'
    FROM (
        SELECT DISTINCT ON (r.user_id) r.user_id
        FROM runs r
        WHERE r.park_id = p_park_id
          AND r.created_at > now() - interval '30 days'
          AND r.user_id <> auth.uid()
          AND NOT EXISTS (SELECT 1 FROM match_participants mp WHERE mp.match_group_id = v_group_id AND mp.user_id = r.user_id)
          AND NOT is_blocked(auth.uid(), r.user_id)
        LIMIT 2
    ) r;

    RETURN v_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- Fix 3: match-provisioned conversations (provision_match_conversation,
-- 0022/0026) are created as a bare type='group' row with no created_by
-- -- but every conversations row still gets a real, functional
-- invite_code (a generated column). join_group_by_code didn't
-- distinguish these from a real user-created group, so anyone who saw
-- that code (screenshot, log line) could join a conversation meant to
-- be closed to just the matched participants. created_by IS NOT NULL is
-- exactly what already distinguishes create_group's rows from
-- provision_match_conversation's -- no new column needed.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION join_group_by_code(code text)
RETURNS uuid AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM conversations WHERE invite_code = code AND type = 'group' AND created_by IS NOT NULL;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'invalid invite code';
    END IF;

    INSERT INTO conversation_members (conversation_id, user_id) VALUES (v_id, auth.uid())
    ON CONFLICT DO NOTHING;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- Fix 4: check_ins_select_active_public (0021) had no block awareness --
-- a blocked user could still see the blocker's live location via a
-- public check-in, undermining the reason someone blocks another user
-- in the first place.
DROP POLICY check_ins_select_active_public ON check_ins;
CREATE POLICY check_ins_select_active_public ON check_ins
    FOR SELECT USING (expires_at > now() AND NOT is_blocked(auth.uid(), user_id));

-- Fix 5: profiles_public (0020) had no block awareness either -- a
-- blocked user could still resolve the blocker's display_name/avatar/
-- bio/home_gym_id/home_park_id (and, combined with fix 4's gap, use the
-- latter to find them in person). auth.uid() inside a view definition
-- still reads the querying session's JWT claim (a session-level GUC,
-- independent of the view's owner-privilege table access), so this
-- correctly reflects the real caller, not the view owner.
CREATE OR REPLACE VIEW profiles_public AS
    SELECT id, display_name, avatar_url, bio, home_gym_id, home_park_id
    FROM profiles
    WHERE NOT is_blocked(auth.uid(), id);

-- Fix 6: no CHECK constraint tied match_groups.pace_bucket to the
-- client's hand-maintained bucket-key list (ProposeMatchScreen) -- a
-- mismatched key would silently create a permanently-unmatchable group
-- instead of failing loudly at the point of the mistake.
ALTER TABLE match_groups ADD CONSTRAINT match_groups_pace_bucket_valid
    CHECK (pace_bucket IN ('sub_4_00', '4_00_4_30', '4_30_5_00', '5_00_5_30', '5_30_6_00', '6_00_plus'));

-- Fix 7: conversation_members/match_participants had no index on
-- user_id, only composite PKs/uniques leading with a different column
-- -- both RLS and the client's own inbox/pending-match queries filter
-- primarily by user_id = auth.uid(), forcing a sequential scan as rows
-- accumulate without one.
CREATE INDEX conversation_members_user_id_idx ON conversation_members (user_id);
CREATE INDEX match_participants_user_id_idx ON match_participants (user_id);

-- +goose Down
DROP INDEX match_participants_user_id_idx;
DROP INDEX conversation_members_user_id_idx;
ALTER TABLE match_groups DROP CONSTRAINT match_groups_pace_bucket_valid;

CREATE OR REPLACE VIEW profiles_public AS
    SELECT id, display_name, avatar_url, bio, home_gym_id, home_park_id
    FROM profiles;

DROP POLICY check_ins_select_active_public ON check_ins;
CREATE POLICY check_ins_select_active_public ON check_ins
    FOR SELECT USING (expires_at > now());

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION join_group_by_code(code text)
RETURNS uuid AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM conversations WHERE invite_code = code AND type = 'group';
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'invalid invite code';
    END IF;

    INSERT INTO conversation_members (conversation_id, user_id) VALUES (v_id, auth.uid())
    ON CONFLICT DO NOTHING;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION propose_match(p_park_id uuid, p_pace_bucket text)
RETURNS uuid AS $$
DECLARE
    v_running_sport_id uuid;
    v_group_id          uuid;
BEGIN
    SELECT id INTO v_running_sport_id FROM sports WHERE slug = 'running';

    SELECT id INTO v_group_id FROM match_groups
    WHERE park_id = p_park_id AND pace_bucket = p_pace_bucket AND status = 'open'
      AND NOT EXISTS (SELECT 1 FROM match_participants mp WHERE mp.match_group_id = match_groups.id AND mp.user_id = auth.uid())
    LIMIT 1;

    IF v_group_id IS NULL THEN
        INSERT INTO match_groups (sport_id, park_id, pace_bucket)
        VALUES (v_running_sport_id, p_park_id, p_pace_bucket)
        RETURNING id INTO v_group_id;
    END IF;

    INSERT INTO match_participants (match_group_id, user_id, status, responded_at)
    VALUES (v_group_id, auth.uid(), 'accepted', now())
    ON CONFLICT (match_group_id, user_id) DO NOTHING;

    INSERT INTO match_participants (match_group_id, user_id, status)
    SELECT v_group_id, r.user_id, 'invited'
    FROM (
        SELECT DISTINCT ON (r.user_id) r.user_id
        FROM runs r
        WHERE r.park_id = p_park_id
          AND r.created_at > now() - interval '30 days'
          AND r.user_id <> auth.uid()
          AND NOT EXISTS (SELECT 1 FROM match_participants mp WHERE mp.match_group_id = v_group_id AND mp.user_id = r.user_id)
          AND NOT EXISTS (
              SELECT 1 FROM blocks b
              WHERE (b.blocker_id = r.user_id AND b.blocked_id = auth.uid())
                 OR (b.blocker_id = auth.uid() AND b.blocked_id = r.user_id)
          )
        LIMIT 2
    ) r;

    RETURN v_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

DROP POLICY messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = conversation_id
          AND (
            (c.type = 'group' AND is_conversation_member(c.id, auth.uid()))
            OR (c.type = 'direct' AND is_conversation_member(c.id, auth.uid()) AND NOT EXISTS (
                SELECT 1 FROM conversation_members other
                WHERE other.conversation_id = c.id AND other.user_id <> auth.uid()
                  AND is_blocked(auth.uid(), other.user_id)
            ))
            OR (c.type = 'location' AND EXISTS (
                SELECT 1 FROM check_ins ci
                WHERE ci.location_type = c.location_type AND ci.location_id = c.location_id
                  AND ci.user_id = auth.uid() AND ci.expires_at > now()
            ))
          )
    )
);
