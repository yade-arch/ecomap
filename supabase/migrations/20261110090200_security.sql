-- EcoMap — 3/4: who may do what
-- Two layers, both explicit:
--   1. GRANTs  — which Postgres role may touch a table/column/function at all;
--   2. RLS     — which rows that role may see or change.
-- The app never writes to reports, photos, cleanups or points directly. Those go through
-- the functions in the previous migration, so a modified client cannot fake AI results or points.

-- ---------------------------------------------------------------------------
-- Start from zero: no default access for API roles.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on schema private from public;
revoke execute on all functions in schema private from public;

-- Anything created later is private until a migration grants it explicitly.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;

-- The secret key (service_role) is only used by Edge Functions.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- RLS policies call these helpers, so the API roles need to be able to run them.
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.is_admin() to anon, authenticated;
grant execute on function private.is_moderator() to anon, authenticated;
grant execute on function private.is_staff() to anon, authenticated;
grant execute on function private.my_municipality_ids() to anon, authenticated;

-- User RPCs
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.get_my_rank() to authenticated;
grant execute on function public.set_my_roles(text[]) to authenticated;
grant execute on function public.join_cleanup(uuid) to authenticated;
grant execute on function public.leave_cleanup(uuid) to authenticated;
grant execute on function public.moderate_cleanup(uuid, boolean, text) to authenticated;
grant execute on function public.moderate_report(uuid, text, text) to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.delete_chat_message(uuid) to authenticated;
-- Server-only RPCs (report_precheck, submit_report, apply_report_reanalysis, cleanup_precheck,
-- submit_cleanup) are deliberately NOT granted to anon/authenticated.

-- ---------------------------------------------------------------------------
-- app_config
-- ---------------------------------------------------------------------------
grant select on public.app_config to anon, authenticated;
grant update (value, description) on public.app_config to authenticated;

create policy "Config is readable by everyone"
  on public.app_config for select to anon, authenticated
  using (true);
create policy "Admins change config"
  on public.app_config for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- profiles: public information only (no email lives here).
-- Column-level UPDATE grant = points and counters can never be edited from the app.
-- ---------------------------------------------------------------------------
grant select on public.profiles to anon, authenticated;
grant update (display_name, avatar_url, country, city, preferred_language, leaderboard_hidden)
  on public.profiles to authenticated;

create policy "Profiles are public"
  on public.profiles for select to anon, authenticated
  using (true);
create policy "Users edit their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
grant select on public.user_roles to anon, authenticated;
create policy "Ordinary roles are public"
  on public.user_roles for select to anon, authenticated
  using (true);
-- No insert/update/delete policy: roles change only through set_my_roles().

grant select on public.staff_roles to authenticated;
create policy "Users see their own staff roles, admins see all"
  on public.staff_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
-- No write policy at all: staff roles are granted from the SQL editor / admin tooling only.

grant select on public.user_bans to authenticated;
create policy "Moderators see bans, users see their own"
  on public.user_bans for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_moderator()));

grant select, insert, delete on public.user_blocks to authenticated;
create policy "Users see their own blocks"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
create policy "Users block as themselves"
  on public.user_blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy "Users unblock their own blocks"
  on public.user_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Municipalities
-- ---------------------------------------------------------------------------
grant select on public.municipalities to anon, authenticated;
create policy "Municipalities are public"
  on public.municipalities for select to anon, authenticated
  using (true);

grant select on public.municipal_users to authenticated;
create policy "Municipal staff see their own membership, admins see all"
  on public.municipal_users for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Reports and everything hanging off them
-- ---------------------------------------------------------------------------
grant select on public.pollution_reports to anon, authenticated;
create policy "Published reports are public, hidden ones are restricted"
  on public.pollution_reports for select to anon, authenticated
  using (
    report_status in ('active', 'cleanup_in_progress', 'pending_verification', 'cleaned')
    or reporter_id = (select auth.uid())
    or (select private.is_moderator())
    or municipality_id in (select private.my_municipality_ids())
  );

-- The sub-select below runs under the caller's own RLS, so "report exists" means "report is visible to me".
grant select on public.pollution_photos to anon, authenticated;
create policy "Photos follow their report's visibility"
  on public.pollution_photos for select to anon, authenticated
  using (exists (select 1 from public.pollution_reports r where r.id = report_id));

grant select on public.report_status_history to anon, authenticated;
create policy "History follows its report's visibility"
  on public.report_status_history for select to anon, authenticated
  using (exists (select 1 from public.pollution_reports r where r.id = report_id));

grant select on public.cleanup_participants to anon, authenticated;
create policy "Volunteers of visible reports are public"
  on public.cleanup_participants for select to anon, authenticated
  using (exists (select 1 from public.pollution_reports r where r.id = report_id));

grant select on public.cleanup_submissions to anon, authenticated;
create policy "Approved cleanups are public, open ones are restricted"
  on public.cleanup_submissions for select to anon, authenticated
  using (
    verification_status in ('ai_approved', 'moderator_approved')
    or activist_id = (select auth.uid())
    or (select private.is_moderator())
    or exists (
      select 1 from public.pollution_reports r
      where r.id = report_id
        and (r.reporter_id = (select auth.uid())
             or r.municipality_id in (select private.my_municipality_ids())))
  );

-- ---------------------------------------------------------------------------
-- Points: private to their owner
-- ---------------------------------------------------------------------------
grant select on public.points_transactions to authenticated;
create policy "Users see their own points history, admins see all"
  on public.points_transactions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Chat: signed-in users only
-- ---------------------------------------------------------------------------
grant select on public.report_chat_rooms to anon, authenticated;
create policy "Rooms follow their report's visibility"
  on public.report_chat_rooms for select to anon, authenticated
  using (exists (select 1 from public.pollution_reports r where r.id = report_id));

grant select on public.chat_messages to authenticated;
grant insert (room_id, sender_id, body) on public.chat_messages to authenticated;
create policy "Signed-in users read messages in rooms they can see"
  on public.chat_messages for select to authenticated
  using (
    (deleted_at is null or (select private.is_moderator()))
    and exists (select 1 from public.report_chat_rooms rm where rm.id = room_id)
  );
create policy "Users write messages only as themselves"
  on public.chat_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (select 1 from public.report_chat_rooms rm where rm.id = room_id)
  );

-- ---------------------------------------------------------------------------
-- Notifications: private
-- ---------------------------------------------------------------------------
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "Users read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users mark their own notifications read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------
grant select on public.moderation_logs to authenticated;
create policy "Staff read the moderation log"
  on public.moderation_logs for select to authenticated
  using ((select private.is_moderator()));

grant select on public.content_reports to authenticated;
grant insert (reporter_id, target_type, target_id, reason) on public.content_reports to authenticated;
grant update (status, resolved_by, resolved_at) on public.content_reports to authenticated;
create policy "Users see flags they raised, moderators see all"
  on public.content_reports for select to authenticated
  using (reporter_id = (select auth.uid()) or (select private.is_moderator()));
create policy "Users flag content as themselves"
  on public.content_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy "Moderators resolve flags"
  on public.content_reports for update to authenticated
  using ((select private.is_moderator()))
  with check ((select private.is_moderator()));
