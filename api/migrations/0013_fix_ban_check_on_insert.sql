-- +goose Up
-- profiles_phone_ban_check only fired on UPDATE OF phone_verified_at.
-- mirror_phone_verified's upsert (0010) takes the INSERT path for a
-- brand-new user with no prior profiles row -- which is the actual first
-- onboarding step in the app (phone verification before profile setup)
-- -- so the ban-evasion check silently never ran for exactly the
-- scenario it exists to catch: a banned phone verifying on a fresh
-- account. Found by an integration test (TestBanEvasionPropagation)
-- exercising that exact path, not by inspection.
DROP TRIGGER profiles_phone_ban_check ON profiles;
CREATE TRIGGER profiles_phone_ban_check
    AFTER INSERT OR UPDATE OF phone_verified_at ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION enforce_phone_ban();

-- +goose Down
DROP TRIGGER profiles_phone_ban_check ON profiles;
CREATE TRIGGER profiles_phone_ban_check
    AFTER UPDATE OF phone_verified_at ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION enforce_phone_ban();
