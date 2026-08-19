-- +goose Up
CREATE TABLE check_ins (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES profiles (id),
    location_type  text NOT NULL CHECK (location_type IN ('gym', 'park')),
    location_id    uuid NOT NULL,
    checked_in_at  timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL
);

CREATE INDEX check_ins_user_id_idx ON check_ins (user_id);

CREATE TABLE personal_records (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES profiles (id),
    gym_id                uuid REFERENCES gyms (id),
    lift_name             text NOT NULL,
    weight                numeric NOT NULL CHECK (weight > 0),
    reps                  integer NOT NULL CHECK (reps > 0),
    calculated_1rm        numeric GENERATED ALWAYS AS (weight * (1 + reps::numeric / 30)) STORED,
    video_storage_path    text,
    verification_status   text NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'flagged')),
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX personal_records_user_id_idx ON personal_records (user_id);

CREATE TABLE runs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES profiles (id),
    park_id               uuid REFERENCES parks (id),
    distance_km           numeric NOT NULL CHECK (distance_km > 0),
    duration_seconds      integer NOT NULL CHECK (duration_seconds > 0),
    pace_seconds_per_km   numeric GENERATED ALWAYS AS (duration_seconds / distance_km) STORED,
    source                text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'strava')),
    distance_bucket       text GENERATED ALWAYS AS (
        CASE
            WHEN distance_km BETWEEN 4.9  AND 5.1  THEN '5k'
            WHEN distance_km BETWEEN 9.8  AND 10.2 THEN '10k'
            WHEN distance_km BETWEEN 20.7 AND 21.5 THEN 'half_marathon'
            WHEN distance_km BETWEEN 41.4 AND 43.0 THEN 'marathon'
            ELSE NULL
        END
    ) STORED,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX runs_user_id_idx ON runs (user_id);

-- +goose Down
DROP TABLE runs;
DROP TABLE personal_records;
DROP TABLE check_ins;
