-- Minimal shim of the parts of the Supabase platform our migrations
-- depend on but don't create themselves (auth schema, auth.uid(), roles).
-- For local RLS test verification only -- never run against a real
-- Supabase project.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone              text,
    phone_confirmed_at timestamptz
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$ LANGUAGE sql STABLE;

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

-- Real Supabase grants authenticated/anon direct EXECUTE on auth.uid() --
-- it's the standard way to call it from custom SQL/functions, not just
-- from inside RLS policy predicates (which don't hit this check the same
-- way). No Phase 1/2 function ever called auth.uid() directly from its
-- own body, so this gap in the shim went unexercised until Phase 3's
-- SECURITY INVOKER RPCs (e.g. create_group) needed it.
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
