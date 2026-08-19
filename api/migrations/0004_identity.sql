-- +goose Up
CREATE TABLE sports (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug  text NOT NULL UNIQUE,
    name  text NOT NULL
);

INSERT INTO sports (slug, name) VALUES
    ('lifting', 'Lifting'),
    ('running', 'Running');

CREATE TABLE gyms (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id      uuid NOT NULL REFERENCES sports (id),
    name          text NOT NULL,
    lat           double precision NOT NULL,
    lng           double precision NOT NULL,
    address       text,
    submitted_by  uuid REFERENCES auth.users (id),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sport_id      uuid NOT NULL REFERENCES sports (id),
    name          text NOT NULL,
    lat           double precision NOT NULL,
    lng           double precision NOT NULL,
    submitted_by  uuid REFERENCES auth.users (id),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
    id                 uuid PRIMARY KEY REFERENCES auth.users (id),
    display_name       text NOT NULL,
    avatar_url         text,
    bio                text,
    home_gym_id        uuid REFERENCES gyms (id),
    home_park_id       uuid REFERENCES parks (id),
    phone_number       text,
    phone_verified_at  timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT profiles_one_home_location
        CHECK (home_gym_id IS NULL OR home_park_id IS NULL)
);

CREATE TABLE user_sports (
    user_id   uuid NOT NULL REFERENCES profiles (id),
    sport_id  uuid NOT NULL REFERENCES sports (id),
    PRIMARY KEY (user_id, sport_id)
);

-- +goose Down
DROP TABLE user_sports;
DROP TABLE profiles;
DROP TABLE parks;
DROP TABLE gyms;
DROP TABLE sports;
