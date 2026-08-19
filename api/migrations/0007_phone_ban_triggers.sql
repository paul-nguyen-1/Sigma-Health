-- +goose Up
-- Mirrors auth.users.phone_confirmed_at onto profiles so the app schema
-- never has to read the auth schema directly.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION mirror_phone_verified()
RETURNS trigger AS $$
BEGIN
    IF NEW.phone_confirmed_at IS NOT NULL AND OLD.phone_confirmed_at IS NULL THEN
        UPDATE profiles
        SET phone_number = NEW.phone, phone_verified_at = NEW.phone_confirmed_at
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- +goose StatementEnd

CREATE TRIGGER auth_users_phone_verified
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION mirror_phone_verified();

-- Auto-propagates an existing ban to a new account when its verified phone
-- number hashes to a match. current_setting() is called without the
-- missing_ok flag deliberately: if app.phone_hash_pepper isn't configured,
-- this must fail loudly rather than silently skip the ban check.
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

CREATE TRIGGER profiles_phone_ban_check
    AFTER UPDATE OF phone_verified_at ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION enforce_phone_ban();

-- +goose Down
DROP TRIGGER profiles_phone_ban_check ON profiles;
DROP FUNCTION enforce_phone_ban();
DROP TRIGGER auth_users_phone_verified ON auth.users;
DROP FUNCTION mirror_phone_verified();
