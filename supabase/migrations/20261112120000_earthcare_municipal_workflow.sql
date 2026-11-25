-- EcoMap 5: EARTHCARE additions
-- Municipality workflow (in-app panel), issue categories beyond pollution, "I see it too" support,
-- public tracking codes, an event timeline, account deletion and panel statistics.
-- The Marmaris area below is an admin-defined TEST AREA, not an official boundary, and the
-- department names are suggestions to be confirmed with the municipality.

-- ---------------------------------------------------------------------------
-- Municipalities, departments, staff roles
-- ---------------------------------------------------------------------------
alter table public.municipalities
  add column if not exists code text check (code is null or code ~ '^[A-Z]{2,5}$'),
  add column if not exists min_lat double precision,
  add column if not exists max_lat double precision,
  add column if not exists min_lng double precision,
  add column if not exists max_lng double precision,
  add column if not exists active boolean not null default true;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid not null references public.municipalities (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  issue_groups text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (municipality_id, name)
);
alter table public.departments enable row level security;

alter table public.municipal_users
  add column if not exists role text not null default 'operator'
    check (role in ('operator', 'manager', 'field', 'verifier')),
  add column if not exists department_id uuid references public.departments (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Reports: category, tracking code, municipal workflow
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.issue_group as enum ('environment', 'park_nature', 'infrastructure', 'disaster');
exception when duplicate_object then null; end $$;

create sequence if not exists public.report_code_seq start 1001;

alter table public.pollution_reports
  add column if not exists public_code text unique,
  add column if not exists issue_group public.issue_group not null default 'environment',
  add column if not exists issue_type text check (issue_type is null or issue_type ~ '^[a-z_]{2,40}$'),
  add column if not exists muni_status text check (muni_status in (
    'submitted', 'accepted', 'assigned', 'in_progress', 'resolved', 'verified', 'rejected', 'duplicate', 'reopened')),
  add column if not exists department_id uuid references public.departments (id) on delete set null,
  add column if not exists assignee_id uuid references public.profiles (id) on delete set null,
  add column if not exists due_at timestamptz,
  add column if not exists resolution_photo_path text check (resolution_photo_path is null or char_length(resolution_photo_path) between 5 and 300),
  add column if not exists resolved_by uuid references public.profiles (id) on delete set null,
  add column if not exists first_response_at timestamptz,
  add column if not exists supports_count integer not null default 0 check (supports_count >= 0);

create index if not exists pollution_reports_muni_queue_idx
  on public.pollution_reports (municipality_id, muni_status, created_at desc);
create index if not exists pollution_reports_assignee_idx on public.pollution_reports (assignee_id);

-- Match new reports to a municipality by its test area, give them a tracking code.
create or replace function private.report_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if new.municipality_id is null then
    select m.id into new.municipality_id
    from public.municipalities m
    where m.active and m.min_lat is not null
      and new.latitude between m.min_lat and m.max_lat
      and new.longitude between m.min_lng and m.max_lng
    order by (m.max_lat - m.min_lat) * (m.max_lng - m.min_lng)
    limit 1;
  end if;
  if new.municipality_id is not null then
    select m.code into v_code from public.municipalities m where m.id = new.municipality_id;
    new.muni_status := coalesce(new.muni_status, 'submitted');
  end if;
  new.public_code := coalesce(v_code, 'ECO') || '-' || nextval('public.report_code_seq')::text;
  return new;
end;
$$;

drop trigger if exists pollution_reports_before_insert on public.pollution_reports;
create trigger pollution_reports_before_insert
  before insert on public.pollution_reports
  for each row execute function private.report_before_insert();

-- A volunteer cleanup that gets verified also closes the municipal case.
create or replace function private.report_sync_muni()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.municipality_id is not null and new.report_status is distinct from old.report_status then
    if new.report_status = 'cleaned' then
      new.muni_status := 'verified';
    elsif new.report_status = 'rejected' and new.muni_status not in ('duplicate') then
      new.muni_status := 'rejected';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pollution_reports_sync_muni on public.pollution_reports;
create trigger pollution_reports_sync_muni
  before update on public.pollution_reports
  for each row execute function private.report_sync_muni();

-- ---------------------------------------------------------------------------
-- Timeline (append-only) and supports
-- ---------------------------------------------------------------------------
create table if not exists public.report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.pollution_reports (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) between 2 and 40),
  from_status text,
  to_status text,
  note text check (note is null or char_length(note) <= 500),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists report_events_report_idx on public.report_events (report_id, created_at);
alter table public.report_events enable row level security;

create table if not exists public.report_supports (
  report_id uuid not null references public.pollution_reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);
create index if not exists report_supports_user_idx on public.report_supports (user_id);
alter table public.report_supports enable row level security;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'report_approved', 'report_rejected', 'report_cleaned', 'cleanup_joined', 'cleanup_submitted',
  'cleanup_approved', 'cleanup_rejected', 'points_awarded', 'system', 'report_status', 'report_supported', 'report_assigned'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.muni_role(p_report_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when private.is_moderator() then 'manager'
    else (select mu.role from public.pollution_reports r
          join public.municipal_users mu on mu.municipality_id = r.municipality_id
          where r.id = p_report_id and mu.user_id = (select auth.uid())
          order by case mu.role when 'manager' then 1 when 'verifier' then 2 when 'operator' then 3 else 4 end
          limit 1)
  end;
$$;

create or replace function private.log_event(
  p_report uuid, p_action text, p_from text, p_to text, p_note text, p_internal boolean)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.report_events (report_id, actor_id, action, from_status, to_status, note, is_internal)
  values (p_report, (select auth.uid()), p_action, p_from, p_to, private.clean_text(p_note, 500), p_internal);
$$;

-- ---------------------------------------------------------------------------
-- Citizen RPCs
-- ---------------------------------------------------------------------------
-- Non-pollution issues (roads, parks, storm damage) skip the pollution AI and use the reporter's severity.
create or replace function public.submit_issue(
  p_photo_path text, p_latitude double precision, p_longitude double precision,
  p_address text, p_city text, p_country text, p_description text,
  p_user_severity text, p_issue_group text, p_issue_type text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_issue_group not in ('park_nature', 'infrastructure', 'disaster') then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'report-photos' and o.name = p_photo_path) then
    return jsonb_build_object('status', 'photo_missing');
  end if;
  v_result := public.submit_report(v_uid, p_photo_path, null, 'image/jpeg', p_latitude, p_longitude,
    p_address, p_city, p_country, p_description, p_user_severity, null);
  if v_result ? 'report_id' and v_result ->> 'status' in ('created', 'pending_review') then
    update public.pollution_reports r set
      issue_group = p_issue_group::public.issue_group,
      issue_type = nullif(p_issue_type, ''),
      ai_analysis_status = 'failed'   -- not applicable: keeps the pollution re-check away
    where r.id = (v_result ->> 'report_id')::uuid;
  end if;
  return v_result;
end;
$$;

-- After a pollution report went through the AI function, the reporter records the sub-type.
create or replace function public.set_report_category(p_report_id uuid, p_issue_group text, p_issue_type text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.pollution_reports r set
    issue_group = p_issue_group::public.issue_group,
    issue_type = nullif(p_issue_type, '')
  where r.id = p_report_id and r.reporter_id = (select auth.uid())
    and r.created_at > now() - interval '30 minutes';
end;
$$;

create or replace function public.support_report(p_report_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.pollution_reports;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into r from public.pollution_reports pr where pr.id = p_report_id;
  if not found or r.report_status in ('rejected', 'cleaned') then
    raise exception 'report_not_open' using errcode = 'P0001';
  end if;
  if r.reporter_id = v_uid then
    raise exception 'own_report' using errcode = 'P0001';
  end if;
  insert into public.report_supports (report_id, user_id) values (p_report_id, v_uid) on conflict do nothing;
  if found then
    update public.pollution_reports pr set supports_count = pr.supports_count + 1 where pr.id = p_report_id;
    perform private.notify(r.reporter_id, 'report_supported', r.id, '{}'::jsonb);
  end if;
  return jsonb_build_object('supports', (select pr.supports_count from public.pollution_reports pr where pr.id = p_report_id));
end;
$$;

-- Deletes the caller's account. Reports stay on the map anonymously (reporter set to null).
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from auth.users u where u.id = v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Municipal panel RPCs
-- ---------------------------------------------------------------------------
create or replace function public.muni_update(
  p_report_id uuid, p_action text, p_note text default null,
  p_department_id uuid default null, p_assignee_id uuid default null, p_due_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.muni_role(p_report_id);
  r public.pollution_reports;
  v_next text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_role is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'note' then
    perform private.log_event(r.id, 'note', r.muni_status, r.muni_status, p_note, true);
    return jsonb_build_object('status', 'ok');
  end if;

  if p_action in ('accept', 'assign', 'reject', 'duplicate') and v_role = 'field' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_action = 'start' and v_role = 'field' and r.assignee_id is distinct from v_uid then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_action = 'accept' then
    if r.report_status = 'pending_review' then
      perform public.moderate_report(r.id, 'approve', p_note);
    end if;
    v_next := 'accepted';
  elsif p_action = 'assign' then
    if r.report_status not in ('active', 'cleanup_in_progress') and r.report_status <> 'pending_review' then
      raise exception 'report_not_open' using errcode = 'P0001';
    end if;
    if r.report_status = 'pending_review' then
      perform public.moderate_report(r.id, 'approve', p_note);
    end if;
    if p_department_id is not null and not exists (
      select 1 from public.departments d where d.id = p_department_id and d.municipality_id = r.municipality_id) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if p_assignee_id is not null and not exists (
      select 1 from public.municipal_users mu where mu.user_id = p_assignee_id and mu.municipality_id = r.municipality_id) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    update public.pollution_reports pr set
      department_id = coalesce(p_department_id, pr.department_id),
      assignee_id = coalesce(p_assignee_id, pr.assignee_id),
      due_at = coalesce(p_due_at, pr.due_at)
    where pr.id = r.id;
    if p_assignee_id is not null then
      perform private.notify(p_assignee_id, 'report_assigned', r.id, jsonb_build_object('code', r.public_code));
    end if;
    v_next := 'assigned';
  elsif p_action = 'start' then
    if r.report_status not in ('active', 'cleanup_in_progress') then
      raise exception 'report_not_open' using errcode = 'P0001';
    end if;
    v_next := 'in_progress';
  elsif p_action in ('reject', 'duplicate') then
    if r.report_status in ('cleaned', 'rejected') then
      raise exception 'report_already_closed' using errcode = 'P0001';
    end if;
    perform public.moderate_report(r.id, 'reject', p_note);
    v_next := case when p_action = 'reject' then 'rejected' else 'duplicate' end;
  elsif p_action = 'reopen' then
    if r.report_status <> 'pending_verification' or r.muni_status <> 'resolved' then
      raise exception 'nothing_to_approve' using errcode = 'P0001';
    end if;
    perform private.set_actor(v_uid, 'municipal_reopen');
    update public.pollution_reports pr set report_status = 'active', resolution_photo_path = null, resolved_by = null
    where pr.id = r.id;
    v_next := 'reopened';
  else
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;

  update public.pollution_reports pr set
    muni_status = v_next,
    first_response_at = coalesce(pr.first_response_at, now())
  where pr.id = r.id;
  perform private.log_event(r.id, p_action, r.muni_status, v_next, p_note, false);
  perform private.notify(r.reporter_id, 'report_status', r.id,
    jsonb_build_object('muni_status', v_next, 'code', r.public_code));
  return jsonb_build_object('status', 'ok', 'muni_status', v_next);
end;
$$;

-- Field staff upload the "after" photo (cleanup-photos/<their id>/<uuid>.jpg) and mark the job done.
create or replace function public.muni_resolve(p_report_id uuid, p_photo_path text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.muni_role(p_report_id);
  r public.pollution_reports;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_role is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if not found or r.report_status not in ('active', 'cleanup_in_progress') then
    raise exception 'report_not_open' using errcode = 'P0001';
  end if;
  if p_photo_path is null
     or p_photo_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'cleanup-photos' and o.name = p_photo_path) then
    raise exception 'invalid_photo' using errcode = 'P0001';
  end if;

  insert into public.pollution_photos (report_id, uploader_id, kind, bucket, path)
  values (r.id, v_uid, 'cleanup_after', 'cleanup-photos', p_photo_path)
  on conflict do nothing;

  perform private.set_actor(v_uid, 'municipal_resolved');
  update public.pollution_reports pr set
    report_status = 'pending_verification',
    muni_status = 'resolved',
    resolution_photo_path = p_photo_path,
    resolved_by = v_uid,
    first_response_at = coalesce(pr.first_response_at, now())
  where pr.id = r.id;
  perform private.log_event(r.id, 'resolve', r.muni_status, 'resolved', p_note, false);
  perform private.notify(r.reporter_id, 'report_status', r.id,
    jsonb_build_object('muni_status', 'resolved', 'code', r.public_code));
  return jsonb_build_object('status', 'ok', 'muni_status', 'resolved');
end;
$$;

-- A verifier, manager or moderator confirms the fix (green) or sends it back.
create or replace function public.muni_verify(p_report_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := private.muni_role(p_report_id);
  r public.pollution_reports;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_role is null or v_role not in ('manager', 'verifier') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if not found or r.report_status <> 'pending_verification' or r.muni_status <> 'resolved' then
    raise exception 'nothing_to_approve' using errcode = 'P0001';
  end if;
  -- Separation of duties: whoever fixed it does not verify it (platform admins excepted, for demos).
  if r.resolved_by = v_uid and not private.is_admin() then
    raise exception 'cannot_verify_own_cleanup' using errcode = '42501';
  end if;

  if not p_approve then
    return public.muni_update(p_report_id, 'reopen', p_note);
  end if;

  perform private.set_actor(v_uid, 'municipal_verified');
  update public.pollution_reports pr set
    report_status = 'cleaned',
    cleaned_at = now(),
    cleaned_photo_path = r.resolution_photo_path,
    muni_status = 'verified'
  where pr.id = r.id;
  perform private.log_event(r.id, 'verify', 'resolved', 'verified', p_note, false);
  perform private.notify(r.reporter_id, 'report_cleaned', r.id, jsonb_build_object('code', r.public_code));
  return jsonb_build_object('status', 'ok', 'muni_status', 'verified');
end;
$$;

-- Numbers for the panel's summary (only the caller's municipalities, or everything for moderators).
create or replace function public.muni_stats()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with scope as (
    select r.* from public.pollution_reports r
    where r.municipality_id is not null
      and (private.is_moderator() or r.municipality_id in (select private.my_municipality_ids()))
  )
  select jsonb_build_object(
    'total', (select count(*) from scope),
    'by_status', coalesce((select jsonb_object_agg(s, n) from (
      select coalesce(muni_status, 'submitted') s, count(*) n from scope group by 1) x), '{}'::jsonb),
    'by_group', coalesce((select jsonb_object_agg(g, n) from (
      select issue_group::text g, count(*) n from scope group by 1) y), '{}'::jsonb),
    'median_first_response_h', (select round((percentile_cont(0.5) within group (
      order by extract(epoch from first_response_at - created_at)) / 3600)::numeric, 1)
      from scope where first_response_at is not null),
    'median_resolution_h', (select round((percentile_cont(0.5) within group (
      order by extract(epoch from cleaned_at - created_at)) / 3600)::numeric, 1)
      from scope where cleaned_at is not null),
    'overdue', (select count(*) from scope where due_at < now() and muni_status not in ('verified', 'rejected', 'duplicate'))
  );
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.submit_issue(text, double precision, double precision, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.set_report_category(uuid, text, text) to authenticated;
grant execute on function public.support_report(uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.muni_update(uuid, text, text, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.muni_resolve(uuid, text, text) to authenticated;
grant execute on function public.muni_verify(uuid, boolean, text) to authenticated;
grant execute on function public.muni_stats() to authenticated;
grant execute on all functions in schema public to service_role;

grant select on public.departments to anon, authenticated;
grant all on public.departments, public.report_events, public.report_supports to service_role;
grant usage, select on sequence public.report_code_seq to service_role;
create policy "Departments are public"
  on public.departments for select to anon, authenticated using (true);

grant select on public.report_events to anon, authenticated;
create policy "Public timeline follows the report; staff also see internal notes"
  on public.report_events for select to anon, authenticated
  using (
    (not is_internal and exists (select 1 from public.pollution_reports r where r.id = report_id))
    or private.can_moderate_report(report_id)
  );

grant select on public.report_supports to authenticated;
create policy "Users see their own supports"
  on public.report_supports for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Municipal staff see colleagues in their municipality"
  on public.municipal_users for select to authenticated
  using (municipality_id in (select private.my_municipality_ids()));

grant execute on function private.can_moderate_report(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Pilot data: Marmaris test area and suggested departments
-- ---------------------------------------------------------------------------
insert into public.municipalities (name, country, city, code, min_lat, max_lat, min_lng, max_lng)
values ('Marmaris Belediyesi (pilot test alanı)', 'Türkiye', 'Marmaris', 'MRM', 36.70, 37.00, 27.95, 28.45)
on conflict (country, city, name) do update set
  code = excluded.code, min_lat = excluded.min_lat, max_lat = excluded.max_lat,
  min_lng = excluded.min_lng, max_lng = excluded.max_lng;

insert into public.departments (municipality_id, name, issue_groups)
select m.id, d.name, d.groups
from public.municipalities m
cross join (values
  ('Temizlik İşleri (öneri)', array['environment']),
  ('Park ve Bahçeler (öneri)', array['park_nature']),
  ('Fen İşleri (öneri)', array['infrastructure']),
  ('Zabıta / Çevre Koruma (öneri)', array['environment']),
  ('Afet Koordinasyon (öneri)', array['disaster'])
) as d(name, groups)
where m.code = 'MRM'
on conflict (municipality_id, name) do nothing;

-- Existing reports: attach to the test area and give them codes.
update public.pollution_reports r set
  municipality_id = coalesce(r.municipality_id, (
    select m.id from public.municipalities m
    where m.min_lat is not null and r.latitude between m.min_lat and m.max_lat
      and r.longitude between m.min_lng and m.max_lng limit 1))
where r.municipality_id is null;
update public.pollution_reports r set
  public_code = coalesce((select m.code from public.municipalities m where m.id = r.municipality_id), 'ECO')
    || '-' || nextval('public.report_code_seq')::text,
  muni_status = case when r.municipality_id is null then null
                     when r.report_status = 'cleaned' then 'verified'
                     when r.report_status = 'rejected' then 'rejected'
                     else 'submitted' end
where r.public_code is null;
