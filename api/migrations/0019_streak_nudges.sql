-- +goose Up
-- Supabase-only (needs pg_cron/pg_net, which aren't available in a plain
-- local Postgres) -- excluded from integrationtest/setup.sh's local run,
-- same as 0009. This is the one place in the schema so far that needs a
-- scheduled job rather than a row-mutation trigger: "nudge someone who
-- hasn't checked in yet today" can't be expressed as a reaction to a
-- write, since the thing that should happen is the *absence* of one.
-- See .claude.roadmap.phase2.md §0 Case 2 for why this was chosen over
-- a Go endpoint + external scheduler.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- +goose StatementBegin
-- SECURITY DEFINER, search_path pinned (migration 0011 lesson) --
-- includes `net` explicitly since pg_net's functions live in that
-- schema, not under `extensions`.
CREATE OR REPLACE FUNCTION send_streak_nudges()
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    -- Eligible: has a push token, and hasn't checked in or completed a
    -- scheduled plan session yet today. Timezone-naive by design for
    -- MVP -- CURRENT_DATE is server-local (UTC), not per-user local
    -- time; a fixed send window (below) is the accepted tradeoff, see
    -- §8's risk note rather than building per-user timezone handling
    -- speculatively.
    FOR r IN
        SELECT p.id, p.expo_push_token
        FROM profiles p
        WHERE p.expo_push_token IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM check_ins ci
              WHERE ci.user_id = p.id AND ci.checked_in_at::date = CURRENT_DATE
          )
          AND NOT EXISTS (
              SELECT 1 FROM user_plan_sessions ups
              JOIN user_plans up ON up.id = ups.user_plan_id
              WHERE up.user_id = p.id AND ups.completed_at::date = CURRENT_DATE
          )
    LOOP
        -- Fire-and-forget: pg_net queues the HTTP call asynchronously,
        -- doesn't block this loop waiting on Expo's push API.
        PERFORM net.http_post(
            url := 'https://exp.host/--/api/v2/push/send',
            headers := '{"Content-Type": "application/json"}'::jsonb,
            body := jsonb_build_object(
                'to', r.expo_push_token,
                'title', 'Keep your streak alive',
                'body', 'You haven''t checked in or trained today yet.'
            )
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net;
-- +goose StatementEnd

-- 8pm UTC daily -- a single fixed window, not per-user timezone-aware.
SELECT cron.schedule('daily-streak-nudge', '0 20 * * *', 'SELECT send_streak_nudges()');

-- +goose Down
SELECT cron.unschedule('daily-streak-nudge');
DROP FUNCTION send_streak_nudges();
DROP EXTENSION IF EXISTS pg_net;
DROP EXTENSION IF EXISTS pg_cron;
