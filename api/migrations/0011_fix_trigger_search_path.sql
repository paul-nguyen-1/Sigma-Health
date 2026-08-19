-- +goose Up
-- mirror_phone_verified and enforce_phone_ban are SECURITY DEFINER but
-- never pinned search_path, so they resolved unqualified table/function
-- names (profiles, moderation_bans, digest(), encode()) using whichever
-- search_path the FIRING connection happened to have. That worked when
-- our Go API's pool triggered them, but GoTrue's own connection --  the
-- one that actually fires these during a real phone verification -- does
-- not have `public` (or `extensions`, where Supabase installs pgcrypto)
-- on its search_path. The unqualified INSERT INTO profiles inside
-- mirror_phone_verified failed with "relation profiles does not exist",
-- which rolled back the entire /auth/v1/verify transaction -- including
-- the OTP check that had already succeeded. Pin search_path explicitly so
-- these don't depend on the caller's environment at all.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION mirror_phone_verified()
RETURNS trigger AS $$
BEGIN
    IF NEW.phone_confirmed_at IS NOT NULL AND OLD.phone_confirmed_at IS NULL THEN
        INSERT INTO profiles (id, display_name, phone_number, phone_verified_at)
        VALUES (NEW.id, '', NEW.phone, NEW.phone_confirmed_at)
        ON CONFLICT (id) DO UPDATE
        SET phone_number = EXCLUDED.phone_number, phone_verified_at = EXCLUDED.phone_verified_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION enforce_phone_ban()
RETURNS trigger AS $$
DECLARE
    v_hash text;
BEGIN
    IF NEW.phone_verified_at IS NULL OR NEW.phone_number IS NULL THEN
        RETURN NEW;
    END IF;

    v_hash := encode(
        digest(NEW.phone_number || current_setting('app.phone_hash_pepper'), 'sha256'),
        'hex'
    );

    IF EXISTS (
        SELECT 1 FROM moderation_bans
        WHERE phone_number_hash = v_hash AND lifted_at IS NULL
    ) THEN
        INSERT INTO moderation_bans (user_id, reason, phone_number_hash, banned_by, banned_at)
        VALUES (NEW.id, 'auto: phone matches an existing ban', v_hash, NULL, now());
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION enforce_phone_ban()
RETURNS trigger AS $$
DECLARE
    v_hash text;
BEGIN
    IF NEW.phone_verified_at IS NULL OR NEW.phone_number IS NULL THEN
        RETURN NEW;
    END IF;

    v_hash := encode(
        digest(NEW.phone_number || current_setting('app.phone_hash_pepper'), 'sha256'),
        'hex'
    );

    IF EXISTS (
        SELECT 1 FROM moderation_bans
        WHERE phone_number_hash = v_hash AND lifted_at IS NULL
    ) THEN
        INSERT INTO moderation_bans (user_id, reason, phone_number_hash, banned_by, banned_at)
        VALUES (NEW.id, 'auto: phone matches an existing ban', v_hash, NULL, now());
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION mirror_phone_verified()
RETURNS trigger AS $$
BEGIN
    IF NEW.phone_confirmed_at IS NOT NULL AND OLD.phone_confirmed_at IS NULL THEN
        INSERT INTO profiles (id, display_name, phone_number, phone_verified_at)
        VALUES (NEW.id, '', NEW.phone, NEW.phone_confirmed_at)
        ON CONFLICT (id) DO UPDATE
        SET phone_number = EXCLUDED.phone_number, phone_verified_at = EXCLUDED.phone_verified_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- +goose StatementEnd
