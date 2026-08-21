-- +goose Up
-- Attribution only -- no reward-granting logic. The roadmap's own
-- reward example ("an extra plan template, early access to a feature")
-- is illustrative, not decided; building a specific reward mechanism
-- now would be speculative. See phase3.md §0 Case 8.
ALTER TABLE profiles ADD COLUMN referral_code text
    GENERATED ALWAYS AS (upper(substr(replace(id::text, '-', ''), 1, 8))) STORED UNIQUE;
ALTER TABLE profiles ADD COLUMN referred_by uuid REFERENCES profiles (id);

-- profiles stays self-only (0008/0020's whole point) -- resolving
-- someone else's code during signup needs a narrow read path instead
-- of a profiles_public column, since nothing else in this phase needs
-- to browse other users' referral codes. search_path pinned per the
-- migration 0011 lesson.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION resolve_referral_code(p_code text)
RETURNS uuid AS $$
    SELECT id FROM profiles WHERE referral_code = p_code;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions;
-- +goose StatementEnd

-- Not SECURITY DEFINER -- pure validation (reject a change), not a
-- privilege grant, so it runs as whoever performs the UPDATE. A CHECK
-- constraint can't reference OLD, hence a trigger.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION enforce_referred_by_immutable()
RETURNS trigger AS $$
BEGIN
    IF OLD.referred_by IS NOT NULL AND NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
        RAISE EXCEPTION 'referred_by cannot be changed once set';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;
-- +goose StatementEnd

CREATE TRIGGER profiles_referred_by_immutable
    BEFORE UPDATE OF referred_by ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION enforce_referred_by_immutable();

-- +goose Down
DROP TRIGGER profiles_referred_by_immutable ON profiles;
DROP FUNCTION enforce_referred_by_immutable();
DROP FUNCTION resolve_referral_code(text);
ALTER TABLE profiles DROP COLUMN referred_by;
ALTER TABLE profiles DROP COLUMN referral_code;
