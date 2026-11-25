-- EcoMap — 4/4: photo storage, realtime, default configuration

-- ---------------------------------------------------------------------------
-- Storage buckets
-- Photos of pollution are meant to be seen by everyone, so the buckets are public-read.
-- File names are random UUIDs inside a folder named after the uploader's user id.
-- Size and type limits are enforced by Storage itself, not by the app.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('report-photos', 'report-photos', true, 6291456, array['image/jpeg', 'image/png', 'image/webp']),
  ('cleanup-photos', 'cleanup-photos', true, 6291456, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload only into your own folder. No UPDATE or DELETE policy for evidence buckets,
-- so a photo can never be replaced or removed from the app once it is uploaded.
create policy "Users upload evidence into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('report-photos', 'cleanup-photos')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users see their own avatar files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users replace their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- Realtime: the app receives these changes live (RLS still applies to what each user gets)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.pollution_reports,
  public.chat_messages,
  public.cleanup_participants,
  public.cleanup_submissions,
  public.notifications;

-- ---------------------------------------------------------------------------
-- Default configuration. Change a value with:
--   update public.app_config set value = '40' where key = 'points.report.high';
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('points.report.low', '10', 'Points for an accepted low-severity report'),
  ('points.report.medium', '20', 'Points for an accepted medium-severity report'),
  ('points.report.high', '30', 'Points for an accepted high-severity report'),
  ('points.cleanup.low', '10', 'Points per person for a verified cleanup of a low-severity report'),
  ('points.cleanup.medium', '20', 'Points per person for a verified cleanup of a medium-severity report'),
  ('points.cleanup.high', '30', 'Points per person for a verified cleanup of a high-severity report'),
  ('ai.min_confidence', '0.5', 'Below this the AI answer is treated as "photo unclear"'),
  ('ai.report_auto_accept_confidence', '0.8', 'At or above this a report is published without a moderator'),
  ('ai.cleanup_auto_verify_confidence', '0.85', 'At or above this a cleanup is approved (or refused) without a moderator'),
  ('limits.reports_per_day', '20', 'Maximum reports one user can create in 24 hours'),
  ('limits.cleanups_per_day', '20', 'Maximum cleanup submissions one user can send in 24 hours'),
  ('limits.chat_messages_per_minute', '12', 'Maximum chat messages one user can send per minute'),
  ('duplicates.radius_m', '25', 'A new report this close to an open one is treated as a duplicate'),
  ('cleanup.max_distance_m', '300', 'How far from the report the after-photo may be taken'),
  ('cleanup.max_auto_participants', '5', 'More volunteers than this sends the cleanup to a moderator'),
  ('cleanup.self_clean_requires_review', 'true', 'Cleaning your own report always needs a moderator')
on conflict (key) do nothing;
