-- +goose Up
-- Supabase Realtime's postgres_changes only broadcasts for tables
-- explicitly added to the supabase_realtime publication -- 0021 created
-- `messages` but never enabled this, so useConversationMessages'
-- subscription (mobile) was correctly wired but silently received
-- nothing; a manual refetch (leaving/returning to the screen) worked
-- because that's a plain REST query, unrelated to the publication.
-- Found via real on-device testing. RLS still applies to what a given
-- subscriber actually receives (messages_select, migration 0021) --
-- this only controls whether the table emits change events at all.
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- +goose Down
ALTER PUBLICATION supabase_realtime DROP TABLE messages;
