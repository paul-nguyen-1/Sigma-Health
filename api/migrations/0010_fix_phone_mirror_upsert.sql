-- +goose Up
-- mirror_phone_verified (0007) only UPDATEd an existing profiles row. If a
-- user verifies their phone before a profiles row exists — which is the
-- actual planned onboarding order, phone verification runs before profile
-- setup — that UPDATE silently affects zero rows: phone_verified_at never
-- gets mirrored, and the ban-check trigger (which fires off
-- profiles.phone_verified_at changing) never runs either. Upsert instead,
-- so ban enforcement doesn't depend on onboarding step ordering.
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

-- +goose Down
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
