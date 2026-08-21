-- +goose Up
-- Supabase-only (needs pg_net, already enabled by 0019) -- excluded
-- from integrationtest/setup.sh's local run, same as 0009/0019.
-- Extends the exact 0018 (expo_push_token) / 0019 (pg_cron/pg_net,
-- SECURITY DEFINER, search_path pinned) pattern. 0019's trigger was
-- clock-based; these three are write-triggered -- react to a specific
-- insert, not a time window -- recombining sync_personal_records'
-- (0015) reaction-to-a-write shape with 0019's pg_net delivery
-- mechanism. See phase3.md §5.

-- New message push -- DM/group only. Deliberately excludes 'location'
-- conversations: a busy gym channel could have dozens of currently-
-- checked-in members, and pushing every one of them on every message
-- with no mute switch would be actively bad UX this phase has no
-- mechanism to prevent yet -- the proximity trigger below already
-- covers "something happened at my gym" for that surface.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS trigger AS $$
DECLARE
    v_type text;
    r RECORD;
BEGIN
    SELECT type INTO v_type FROM conversations WHERE id = NEW.conversation_id;
    IF v_type NOT IN ('direct', 'group') THEN
        RETURN NEW;
    END IF;

    FOR r IN
        SELECT p.expo_push_token
        FROM conversation_members cm
        JOIN profiles p ON p.id = cm.user_id
        WHERE cm.conversation_id = NEW.conversation_id
          AND cm.user_id <> NEW.sender_id
          AND p.expo_push_token IS NOT NULL
    LOOP
        PERFORM net.http_post(
            url := 'https://exp.host/--/api/v2/push/send',
            headers := '{"Content-Type": "application/json"}'::jsonb,
            body := jsonb_build_object(
                'to', r.expo_push_token,
                'title', 'New message',
                'body', left(NEW.body, 100)
            )
        );
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net;
-- +goose StatementEnd

CREATE TRIGGER messages_notify_new_message
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_message();

-- Match invited push.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_match_invited()
RETURNS trigger AS $$
DECLARE
    v_token text;
BEGIN
    SELECT expo_push_token INTO v_token FROM profiles WHERE id = NEW.user_id;
    IF v_token IS NOT NULL THEN
        PERFORM net.http_post(
            url := 'https://exp.host/--/api/v2/push/send',
            headers := '{"Content-Type": "application/json"}'::jsonb,
            body := jsonb_build_object(
                'to', v_token,
                'title', 'New running match',
                'body', 'You''ve been matched with nearby runners -- respond now.'
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net;
-- +goose StatementEnd

CREATE TRIGGER match_participants_notify_invited
    AFTER INSERT ON match_participants
    FOR EACH ROW
    WHEN (NEW.status = 'invited')
    EXECUTE FUNCTION notify_match_invited();

-- Match ready push -- extends 0022's provision_match_conversation
-- (CREATE OR REPLACE on an earlier migration's function, same pattern
-- 0011 used) to push every accepted participant once the conversation
-- is newly created, not on a later participant just joining one that
-- already exists.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION provision_match_conversation()
RETURNS trigger AS $$
DECLARE
    v_accepted_count integer;
    v_conversation_id uuid;
    v_newly_matched boolean := false;
    r RECORD;
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
            v_newly_matched := true;
        ELSE
            INSERT INTO conversation_members (conversation_id, user_id) VALUES (v_conversation_id, NEW.user_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_newly_matched THEN
        FOR r IN
            SELECT p.expo_push_token
            FROM match_participants mp
            JOIN profiles p ON p.id = mp.user_id
            WHERE mp.match_group_id = NEW.match_group_id AND mp.status = 'accepted' AND p.expo_push_token IS NOT NULL
        LOOP
            PERFORM net.http_post(
                url := 'https://exp.host/--/api/v2/push/send',
                headers := '{"Content-Type": "application/json"}'::jsonb,
                body := jsonb_build_object(
                    'to', r.expo_push_token,
                    'title', 'Your match is ready',
                    'body', 'Say hi to your new running match.'
                )
            );
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net;
-- +goose StatementEnd

-- Proximity push -- "N lifters just checked in at your gym." No new
-- state (no location_presence_notifications table): the threshold-
-- crossing check against the live count naturally rate-limits to at
-- most one notification per threshold per presence cycle, same
-- "leaderboards are a query, not a table" instinct used throughout
-- this phase. Small race window at high concurrency (two check-ins
-- landing simultaneously could both fire) -- accepted, not worth a
-- lock at pilot volumes, see phase3.md §8.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION notify_location_proximity()
RETURNS trigger AS $$
DECLARE
    v_count integer;
    v_threshold integer;
    r RECORD;
BEGIN
    SELECT count(*) INTO v_count FROM check_ins
    WHERE location_type = NEW.location_type AND location_id = NEW.location_id AND expires_at > now();

    FOREACH v_threshold IN ARRAY ARRAY[3, 5, 10] LOOP
        IF v_count - 1 < v_threshold AND v_threshold <= v_count THEN
            FOR r IN
                SELECT p.expo_push_token
                FROM profiles p
                WHERE (
                    (NEW.location_type = 'gym' AND p.home_gym_id = NEW.location_id)
                    OR (NEW.location_type = 'park' AND p.home_park_id = NEW.location_id)
                )
                AND p.id <> NEW.user_id
                AND p.expo_push_token IS NOT NULL
                AND NOT EXISTS (
                    SELECT 1 FROM check_ins ci2
                    WHERE ci2.user_id = p.id AND ci2.location_type = NEW.location_type
                      AND ci2.location_id = NEW.location_id AND ci2.expires_at > now()
                )
            LOOP
                PERFORM net.http_post(
                    url := 'https://exp.host/--/api/v2/push/send',
                    headers := '{"Content-Type": "application/json"}'::jsonb,
                    body := jsonb_build_object(
                        'to', r.expo_push_token,
                        'title', 'Your gym is buzzing',
                        'body', v_threshold || ' people just checked in at your gym.'
                    )
                );
            END LOOP;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net;
-- +goose StatementEnd

CREATE TRIGGER check_ins_notify_proximity
    AFTER INSERT ON check_ins
    FOR EACH ROW
    EXECUTE FUNCTION notify_location_proximity();

-- +goose Down
DROP TRIGGER check_ins_notify_proximity ON check_ins;
DROP FUNCTION notify_location_proximity();

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

DROP TRIGGER match_participants_notify_invited ON match_participants;
DROP FUNCTION notify_match_invited();
DROP TRIGGER messages_notify_new_message ON messages;
DROP FUNCTION notify_new_message();
