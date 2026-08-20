-- +goose Up
-- One token per user, overwritten on each registration -- multi-device
-- push (a user with the app on two phones) isn't something this pilot
-- needs yet; a separate push_tokens table is a one-migration upgrade if
-- that ever matters. No RLS change needed: profiles_update_own (0008)
-- already covers a self-only write to this column.
ALTER TABLE profiles ADD COLUMN expo_push_token text;

-- +goose Down
ALTER TABLE profiles DROP COLUMN expo_push_token;
