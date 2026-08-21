-- +goose Up
-- Pace-based (runner) matching is the only case needing real
-- match_groups/match_participants state -- unlike a gym cluster
-- (mutually visible via check_ins already, see 0021), pairing two
-- strangers by pace bucket is a genuine proposal between people with
-- no existing shared visibility, and per "Safety is Phase 1, not a
-- bolt-on," consent should gate a DM opening. Deliberately NOT
-- polymorphic like check_ins/conversations -- park_id is a plain FK
-- since this is scoped to running/parks only; lifting needs no table
-- here at all (see phase3.md §0 Case 3). See §0 Case 5.
CREATE TABLE match_groups (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id        uuid NOT NULL REFERENCES sports (id),
    park_id         uuid NOT NULL REFERENCES parks (id),
    pace_bucket     text NOT NULL,
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'expired')),
    conversation_id uuid REFERENCES conversations (id),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match_participants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_group_id  uuid NOT NULL REFERENCES match_groups (id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    status          text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined')),
    responded_at    timestamptz,
    UNIQUE (match_group_id, user_id)
);

ALTER TABLE match_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_groups_select ON match_groups FOR SELECT
    USING (EXISTS (SELECT 1 FROM match_participants mp WHERE mp.match_group_id = match_groups.id AND mp.user_id = auth.uid()));
-- No INSERT/UPDATE/DELETE policy at all -- every row/status transition
-- comes from propose_match/the trigger below, same "readable, not
-- writable" shape as user_plan_sessions.

-- Self-referencing, same shape as conversation_members' recursion trap
-- in 0021: a plain predicate here raised "infinite recursion detected
-- in policy for relation match_participants" against a real local
-- Postgres (confirmed during Week 1 verification, per phase3.md §0
-- Case 5's flagged risk) -- so this needs the identical SECURITY
-- DEFINER wrapper fix as is_conversation_member, not the plain
-- predicate originally sketched in the plan doc.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION is_match_participant(grp_id uuid, uid uuid DEFAULT auth.uid())
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM match_participants
        WHERE match_group_id = grp_id AND user_id = uid
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

ALTER TABLE match_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_participants_select ON match_participants FOR SELECT
    USING (user_id = auth.uid() OR is_match_participant(match_group_id, auth.uid()));
CREATE POLICY match_participants_respond ON match_participants FOR UPDATE
    USING (user_id = auth.uid() AND status = 'invited')
    WITH CHECK (user_id = auth.uid() AND status IN ('accepted', 'declined'));
-- No INSERT/DELETE -- rows are only ever created by propose_match.

-- SECURITY DEFINER (grants access -- inviting other users -- a plain
-- client INSERT can't express, since the caller isn't the owner of the
-- rows being created for invitees), search_path pinned per the
-- migration 0011 lesson.
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

    -- Invite up to 2 candidates: recent (30-day) runners at this park
    -- in this pace bucket, excluding the caller, anyone already in
    -- this group, and either direction of a block.
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

-- Correctness-sensitive fan-out, same shape as generate_user_plan_sessions
-- (0016): once enough participants accept, the resulting conversation
-- must be created/populated atomically, not left to a client-side
-- multi-step sequence that could partially fail. search_path pinned
-- per the migration 0011 lesson. Threshold is 2 accepted, not "all
-- invited responded" -- a match opens as soon as a second person
-- accepts; a later acceptance just joins the already-open conversation.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION provision_match_conversation()
RETURNS trigger AS $$
DECLARE
    v_accepted_count integer;
    v_conversation_id uuid;
BEGIN
    IF NEW.status <> 'accepted' THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_accepted_count FROM match_participants
    WHERE match_group_id = NEW.match_group_id AND status = 'accepted';

    IF v_accepted_count >= 2 THEN
        SELECT conversation_id INTO v_conversation_id FROM match_groups WHERE id = NEW.match_group_id;
        IF v_conversation_id IS NULL THEN
            INSERT INTO conversations (type) VALUES ('group') RETURNING id INTO v_conversation_id;
            INSERT INTO conversation_members (conversation_id, user_id)
            SELECT v_conversation_id, mp.user_id FROM match_participants mp
            WHERE mp.match_group_id = NEW.match_group_id AND mp.status = 'accepted';
            UPDATE match_groups SET conversation_id = v_conversation_id, status = 'matched' WHERE id = NEW.match_group_id;
        ELSE
            INSERT INTO conversation_members (conversation_id, user_id) VALUES (v_conversation_id, NEW.user_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

CREATE TRIGGER match_participants_provision_conversation
    AFTER UPDATE OF status ON match_participants
    FOR EACH ROW
    EXECUTE FUNCTION provision_match_conversation();

-- +goose Down
DROP TRIGGER match_participants_provision_conversation ON match_participants;
DROP FUNCTION provision_match_conversation();
DROP FUNCTION propose_match(uuid, text);
-- match_groups_select's policy references match_participants in a
-- subquery, which makes match_groups depend on match_participants --
-- drop that policy explicitly before either table, or DROP TABLE
-- match_participants fails with "other objects depend on it" (found
-- during Week 1 reversibility verification: goose up -> down -> up).
DROP POLICY match_groups_select ON match_groups;
DROP TABLE match_participants;
DROP FUNCTION is_match_participant(uuid, uuid);
DROP TABLE match_groups;
