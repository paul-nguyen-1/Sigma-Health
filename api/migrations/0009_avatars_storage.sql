-- +goose Up
-- Requires the Supabase Storage extension (storage.buckets/storage.objects),
-- not present on a vanilla Postgres instance — this migration only applies
-- cleanly against an actual Supabase project.
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true);

CREATE POLICY avatars_insert_own ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_update_own ON storage.objects FOR UPDATE
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_select_all ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

-- +goose Down
DROP POLICY avatars_select_all ON storage.objects;
DROP POLICY avatars_update_own ON storage.objects;
DROP POLICY avatars_insert_own ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'avatars';
