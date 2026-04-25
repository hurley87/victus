-- Public storage bucket for Commodus assets (avatar, lore imagery, etc.).
--
-- Bucket is public + read-only to anonymous clients via a single broad SELECT
-- policy on storage.objects. Writes still require the service role (no insert
-- policy is defined), matching the rest of the schema's posture.
--
-- file_size_limit = 100 MiB (100 * 1024 * 1024 bytes).

insert into storage.buckets (id, name, public, file_size_limit)
values ('commodus', 'commodus', true, 104857600)
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit;

drop policy if exists "commodus_public_read" on storage.objects;

create policy "commodus_public_read" on storage.objects
for select to public
using (bucket_id = 'commodus');
