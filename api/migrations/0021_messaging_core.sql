-- +goose Up
-- check_ins was self-only (0008) -- nobody could see anyone else's
-- check-ins at all. Widen for currently-active rows only (a user's
-- full history stays private); this is what makes "who's at Gold's Gym
-- right now" a plain query, no new table. See phase3.md §0 Case 3.
CREATE POLICY check_ins_select_active_public ON check_ins
    FOR SELECT USING (expires_at > now());

-- conversations: shared core for DMs, user-created groups, and
-- per-location channels. location_id is deliberately polymorphic with
-- no FK, matching check_ins' existing location_type/location_id
-- convention rather than inventing a new shape.
CREATE TABLE conversations (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type           text NOT NULL CHECK (type IN ('direct', 'group', 'location')),
    name           text,
    location_type  text CHECK (location_type IN ('gym', 'park')),
    location_id    uuid,
    created_by     uuid REFERENCES profiles (id),
    -- Same generated-column idiom as calculated_1rm/pace_seconds_per_km/
    -- distance_bucket -- deterministic, shareable, no collision handling
    -- needed since it derives from the row's own already-unique id.
    invite_code    text GENERATED ALWAYS AS (upper(substr(replace(id::text, '-', ''), 1, 8))) STORED,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT conversations_location_fields_consistent CHECK (
        (type = 'location' AND location_type IS NOT NULL AND location_id IS NOT NULL)
        OR (type <> 'location' AND location_type IS NULL AND location_id IS NULL)
    )
);
-- One conversation per location, ever -- get_or_create_location_conversation
-- below relies on this for idempotency.
CREATE UNIQUE INDEX conversations_location_unique_idx ON conversations (location_type, location_id)
    WHERE type = 'location';

-- Membership rows for 'direct'/'group' only. Location conversations
-- have ZERO conversation_members rows, ever -- membership there is
-- computed at read/write time from check_ins, never stored.
CREATE TABLE conversation_members (
    conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    joined_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    sender_id        uuid NOT NULL REFERENCES profiles (id),
    body             text NOT NULL CHECK (length(body) > 0 AND length(body) <= 2000),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_id_created_at_idx ON messages (conversation_id, created_at);

-- conversation_members' own SELECT policy needs "mine, OR another row
-- in a conversation I'm also in" -- querying the same table from
-- inside its own policy raises "infinite recursion detected in policy"
-- at evaluation time. Routing the self-referencing lookup through a
-- SECURITY DEFINER function breaks the cycle (it bypasses RLS
-- internally, so its own query doesn't re-trigger the policy being
-- evaluated). search_path pinned per the migration 0011 lesson.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION is_conversation_member(conv_id uuid, uid uuid DEFAULT auth.uid())
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM conversation_members
        WHERE conversation_id = conv_id AND user_id = uid
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- blocks (0006) is self-only SELECT on blocker_id -- the blocked party
-- can't see a block made against them. A raw `EXISTS (SELECT ... FROM
-- blocks ...)` inside another table's policy is STILL subject to
-- blocks' own RLS for the querying role, so from the blocked party's
-- side such a subquery silently finds nothing and the check meant to
-- reject them instead passes. Confirmed directly during Week 1
-- verification (identical failure mode to is_conversation_member's
-- recursion trap, different mechanism: RLS-on-a-referenced-table
-- rather than RLS-on-the-same-table). A block must be enforceable
-- regardless of who's querying, so this needs the same SECURITY
-- DEFINER treatment, search_path pinned per the migration 0011 lesson.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION is_blocked(user_a uuid, user_b uuid)
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM blocks
        WHERE (blocker_id = user_a AND blocked_id = user_b)
           OR (blocker_id = user_b AND blocked_id = user_a)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_members_select ON conversation_members FOR SELECT
    USING (user_id = auth.uid() OR is_conversation_member(conversation_id, auth.uid()));
-- Only path a client can INSERT a membership row directly: a group's
-- creator inserting themselves as its first member. Every other way to
-- gain membership (invite code, a DM's other party, an accepted match)
-- goes through one of the functions below.
CREATE POLICY conversation_members_insert_creator ON conversation_members FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id AND c.type = 'group' AND c.created_by = auth.uid())
    );
CREATE POLICY conversation_members_delete_own ON conversation_members FOR DELETE
    USING (user_id = auth.uid());

-- conversations' own SELECT policy queries conversation_members/
-- check_ins (different tables) -- an ordinary cross-table subquery,
-- no recursion risk, so no DEFINER escape hatch needed here.
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_select ON conversations FOR SELECT USING (
    (type IN ('direct', 'group') AND is_conversation_member(id, auth.uid()))
    OR (type = 'location' AND EXISTS (
        SELECT 1 FROM check_ins ci
        WHERE ci.location_type = conversations.location_type
          AND ci.location_id = conversations.location_id
          AND ci.user_id = auth.uid()
          AND ci.checked_in_at > now() - interval '30 days'
    ))
);
-- The only client-writable path into conversations directly: creating
-- a group you'll own. 'direct'/'location' rows only ever come from the
-- functions below -- this WITH CHECK structurally forbids a client
-- from faking either.
CREATE POLICY conversations_insert_group ON conversations FOR INSERT
    WITH CHECK (type = 'group' AND created_by = auth.uid());

-- messages: read uses the same 30-day lookback as conversations' own
-- SELECT; write requires an ACTIVE check-in for location conversations
-- (must be "here" to post, not just have been here before), and for
-- direct conversations is blocked if either party has blocked the
-- other -- even mid-conversation, without needing a separate "unmatch"
-- flow.
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_select ON messages FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = messages.conversation_id
          AND (
            (c.type IN ('direct', 'group') AND is_conversation_member(c.id, auth.uid()))
            OR (c.type = 'location' AND EXISTS (
                SELECT 1 FROM check_ins ci
                WHERE ci.location_type = c.location_type AND ci.location_id = c.location_id
                  AND ci.user_id = auth.uid() AND ci.checked_in_at > now() - interval '30 days'
            ))
          )
    )
);
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
-- No UPDATE/DELETE policy -- messages are immutable, same "just
-- expires, never edited" posture check_ins already established.

-- Three functions granting access a plain client INSERT structurally
-- can't express (cross-user consent, not just row ownership). Each
-- SECURITY DEFINER, search_path pinned per the migration 0011 lesson,
-- idempotent, returns the resulting conversation_id.

-- Called the first time a user opens a given gym/park's channel.
-- Deliberately lazy -- no batch job pre-creates one row per gym/park.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION get_or_create_location_conversation(p_location_type text, p_location_id uuid)
RETURNS uuid AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO conversations (type, location_type, location_id)
    VALUES ('location', p_location_type, p_location_id)
    ON CONFLICT (location_type, location_id) WHERE type = 'location' DO NOTHING;

    SELECT id INTO v_id FROM conversations
    WHERE type = 'location' AND location_type = p_location_type AND location_id = p_location_id;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- Rejects self-DM and either direction of a block; finds an existing
-- direct conversation between the two users or creates one + both
-- membership rows. No unique-constraint-backed idempotency here (a
-- pair of users isn't a single-column uniqueness fact) -- a small race
-- between simultaneous calls is an accepted pilot-scale edge case, see
-- phase3.md §8.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION start_direct_conversation(other_user_id uuid)
RETURNS uuid AS $$
DECLARE
    v_id uuid;
BEGIN
    IF other_user_id = auth.uid() THEN
        RAISE EXCEPTION 'cannot start a direct conversation with yourself';
    END IF;

    IF EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = auth.uid() AND b.blocked_id = other_user_id)
           OR (b.blocker_id = other_user_id AND b.blocked_id = auth.uid())
    ) THEN
        RAISE EXCEPTION 'cannot start a conversation with a blocked user';
    END IF;

    SELECT cm1.conversation_id INTO v_id
    FROM conversation_members cm1
    JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
    JOIN conversations c ON c.id = cm1.conversation_id
    WHERE c.type = 'direct' AND cm1.user_id = auth.uid() AND cm2.user_id = other_user_id
    LIMIT 1;

    IF v_id IS NULL THEN
        INSERT INTO conversations (type) VALUES ('direct') RETURNING id INTO v_id;
        INSERT INTO conversation_members (conversation_id, user_id) VALUES (v_id, auth.uid()), (v_id, other_user_id);
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- The only way anyone other than a group's creator gets in --
-- conversation_members_insert_creator structurally can't cover a
-- non-creator, since they have no ownership claim the RLS WITH CHECK
-- can verify.
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

-- SECURITY DEFINER, search_path pinned per the migration 0011 lesson --
-- corrected from an original SECURITY INVOKER design during Week 1
-- verification against a real local Postgres. The intended rationale
-- was atomicity, not privilege-bypass, but INVOKER genuinely can't
-- work here regardless of intent: `INSERT ... RETURNING id INTO v_id`
-- against conversations, before the conversation_members row exists,
-- requires the new row to satisfy conversations_select's policy (which
-- depends on is_conversation_member) to be returned at all -- and no
-- membership row exists yet at that exact moment, so Postgres raises
-- "new row violates row-level security policy" on the RETURNING
-- clause itself, before the membership insert ever runs. Confirmed
-- directly: identical failure on a bare INSERT ... RETURNING with no
-- function involved. DEFINER sidesteps this chicken-and-egg problem
-- entirely (it bypasses RLS for its own internal statements), which is
-- also why every other function in this file that does an INSERT
-- ... RETURNING against conversations (get_or_create_location_conversation,
-- start_direct_conversation) is DEFINER, not INVOKER.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION create_group(name text)
RETURNS uuid AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO conversations (type, name, created_by) VALUES ('group', name, auth.uid()) RETURNING id INTO v_id;
    INSERT INTO conversation_members (conversation_id, user_id) VALUES (v_id, auth.uid());
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION create_group(text);
DROP FUNCTION join_group_by_code(text);
DROP FUNCTION start_direct_conversation(uuid);
DROP FUNCTION get_or_create_location_conversation(text, uuid);
DROP TABLE messages;
DROP FUNCTION is_blocked(uuid, uuid);
DROP TABLE conversation_members;
DROP TABLE conversations;
DROP FUNCTION is_conversation_member(uuid, uuid);
DROP POLICY check_ins_select_active_public ON check_ins;
