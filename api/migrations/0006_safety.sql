-- +goose Up
CREATE TABLE moderation_bans (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid NOT NULL REFERENCES profiles (id),
    reason             text NOT NULL,
    related_report_id  uuid,
    phone_number_hash  text NOT NULL,
    banned_by          uuid REFERENCES profiles (id),
    banned_at          timestamptz NOT NULL DEFAULT now(),
    lifted_at          timestamptz
);
CREATE INDEX moderation_bans_phone_hash_idx ON moderation_bans (phone_number_hash);
CREATE INDEX moderation_bans_user_id_idx ON moderation_bans (user_id);

CREATE TABLE reports (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id       uuid NOT NULL REFERENCES profiles (id),
    reported_user_id  uuid NOT NULL REFERENCES profiles (id),
    reason            text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reports_no_self_report CHECK (reporter_id <> reported_user_id)
);

CREATE TABLE blocks (
    blocker_id  uuid NOT NULL REFERENCES profiles (id),
    blocked_id  uuid NOT NULL REFERENCES profiles (id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id)
);

-- moderation_bans.related_report_id intentionally has no FK: a ban can
-- exist without an originating report (auto-propagated bans, see
-- 0007_phone_ban_triggers.sql), so it's a loose reference, not enforced.

-- +goose Down
DROP TABLE blocks;
DROP TABLE reports;
DROP TABLE moderation_bans;
