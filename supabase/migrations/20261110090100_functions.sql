-- EcoMap — 2/4: business logic
-- Rules of this file:
--   * every function pins search_path to '' and uses fully qualified names;
--   * helpers and trigger functions live in `private` (not reachable through the Data API);
--   * functions in `public` are either user RPCs (they check auth.uid()) or
--     server-only RPCs (callable only with the secret key from Edge Functions).
-- Errors meant for the app are raised with a short machine-readable message (e.g. 'activist_role_required').

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function private.config_num(p_key text, p_default numeric)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(c.value) = 'number' then (c.value #>> '{}')::numeric end
       from public.app_config c where c.key = p_key),
    p_default);
$$;

create or replace function private.config_bool(p_key text, p_default boolean)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(c.value) = 'boolean' then (c.value #>> '{}')::boolean end
       from public.app_config c where c.key = p_key),
    p_default);
$$;

create or replace function private.safe_num(p_text text)
returns numeric
language sql immutable set search_path = ''
as $$
  select case when p_text ~ '^-?[0-9]{1,6}(\.[0-9]{1,6})?$' then p_text::numeric end;
$$;

create or replace function private.safe_severity(p_text text)
returns public.severity_level
language sql immutable set search_path = ''
as $$
  select case when p_text in ('low', 'medium', 'high') then p_text::public.severity_level end;
$$;

create or replace function private.safe_category(p_text text)
returns public.pollution_category
language sql immutable set search_path = ''
as $$
  select case
    when p_text in ('household_waste', 'plastic', 'construction_debris', 'bulky_waste', 'organic',
                    'e_waste', 'hazardous', 'water_pollution', 'burning', 'other')
      then p_text::public.pollution_category
    else 'other'::public.pollution_category
  end;
$$;

create or replace function private.clean_text(p_text text, p_max integer)
returns text
language sql immutable set search_path = ''
as $$
  select nullif(left(btrim(coalesce(p_text, '')), p_max), '');
$$;

-- Great-circle distance in metres.
create or replace function private.distance_m(
  lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable set search_path = ''
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))));
$$;

-- ---------------------------------------------------------------------------
-- Who is the caller?
-- ---------------------------------------------------------------------------
create or replace function private.has_role(p_user uuid, p_role public.app_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role = p_role);
$$;

create or replace function private.is_banned(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.user_bans b where b.user_id = p_user);
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles sr
    where sr.user_id = (select auth.uid()) and sr.role = 'admin');
$$;

create or replace function private.is_moderator()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff_roles sr
    where sr.user_id = (select auth.uid()) and sr.role in ('admin', 'moderator'));
$$;

create or replace function private.my_municipality_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select mu.municipality_id from public.municipal_users mu where mu.user_id = (select auth.uid());
$$;

-- Platform staff can moderate everything; municipal staff only reports in their municipality.
create or replace function private.can_moderate_report(p_report_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_moderator() or exists (
    select 1
    from public.pollution_reports r
    join public.municipal_users mu on mu.municipality_id = r.municipality_id
    where r.id = p_report_id and mu.user_id = (select auth.uid()));
$$;

create or replace function private.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_moderator()
      or exists (select 1 from public.municipal_users mu where mu.user_id = (select auth.uid()));
$$;

-- Lets the app ask "what am I allowed to do?" in one call.
create or replace function public.get_my_access()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'roles', coalesce((select jsonb_agg(ur.role order by ur.role) from public.user_roles ur
                        where ur.user_id = (select auth.uid())), '[]'::jsonb),
    'is_admin', private.is_admin(),
    'is_moderator', private.is_moderator(),
    'is_staff', private.is_staff(),
    'municipality_ids', coalesce((select jsonb_agg(m) from private.my_municipality_ids() m), '[]'::jsonb),
    'is_banned', private.is_banned((select auth.uid()))
  );
$$;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_config_set_updated_at
  before update on public.app_config
  for each row execute function private.set_updated_at();

create or replace function private.profile_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.display_name := btrim(new.display_name);
  new.country := nullif(btrim(coalesce(new.country, '')), '');
  new.city := nullif(btrim(coalesce(new.city, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function private.profile_before_update();

-- ---------------------------------------------------------------------------
-- Sign-up: create the profile and roles from the data the app sent with signUp().
-- That data is user-controlled, so everything is validated and nothing privileged is read from it.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
  v_lang text;
  v_country text;
  v_city text;
  v_role text;
begin
  v_name := left(btrim(coalesce(v_meta ->> 'display_name', v_meta ->> 'full_name', v_meta ->> 'name', '')), 40);
  if char_length(btrim(v_name)) < 2 then
    v_name := 'EcoUser-' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  v_lang := lower(coalesce(v_meta ->> 'preferred_language', 'tr'));
  if v_lang not in ('tr', 'en', 'de', 'fr', 'es') then
    v_lang := 'en';
  end if;

  v_country := private.clean_text(v_meta ->> 'country', 60);
  if v_country is not null and char_length(v_country) < 2 then
    v_country := null;
  end if;
  v_city := private.clean_text(v_meta ->> 'city', 80);

  insert into public.profiles (id, display_name, country, city, preferred_language)
  values (new.id, v_name, v_country, v_city, v_lang)
  on conflict (id) do nothing;

  if jsonb_typeof(v_meta -> 'roles') = 'array' then
    for v_role in select jsonb_array_elements_text(v_meta -> 'roles') loop
      if v_role in ('observer', 'activist') then
        insert into public.user_roles (user_id, role)
        values (new.id, v_role::public.app_role)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  -- Nobody is left without a role: default to both.
  if not exists (select 1 from public.user_roles ur where ur.user_id = new.id) then
    insert into public.user_roles (user_id, role)
    values (new.id, 'observer'), (new.id, 'activist')
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create or replace function private.notify(p_user uuid, p_type text, p_report uuid, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null then
    return;
  end if;
  insert into public.notifications (user_id, type, report_id, data)
  values (p_user, p_type, p_report, coalesce(p_data, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Points ledger
-- ---------------------------------------------------------------------------
create or replace function private.points_for(p_kind text, p_severity public.severity_level)
returns integer
language sql stable security definer set search_path = ''
as $$
  select greatest(1, private.config_num(
    'points.' || p_kind || '.' || p_severity::text,
    case p_severity when 'low' then 10 when 'medium' then 20 else 30 end))::integer;
$$;

-- Returns the new transaction id, or null when the same reward already exists (duplicate protection).
create or replace function private.award_points(
  p_user uuid,
  p_type public.points_transaction_type,
  p_points integer,
  p_report uuid,
  p_submission uuid,
  p_reason text,
  p_related uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or p_points is null or p_points = 0 then
    return null;
  end if;
  insert into public.points_transactions
    (user_id, report_id, cleanup_submission_id, transaction_type, points, reason, related_transaction_id)
  values (p_user, p_report, p_submission, p_type, p_points, p_reason, p_related)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Keeps the cached totals on the profile in step with the ledger.
create or replace function private.apply_points_transaction()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_related public.points_transaction_type;
begin
  if new.user_id is null then
    return new;
  end if;
  if new.transaction_type = 'reversal' and new.related_transaction_id is not null then
    select pt.transaction_type into v_related
    from public.points_transactions pt where pt.id = new.related_transaction_id;
  end if;
  update public.profiles p set
    total_points = p.total_points + new.points,
    reports_count = greatest(0, p.reports_count + case
      when new.transaction_type = 'report_reward' then 1
      when v_related = 'report_reward' then -1 else 0 end),
    cleans_count = greatest(0, p.cleans_count + case
      when new.transaction_type = 'cleanup_reward' then 1
      when v_related = 'cleanup_reward' then -1 else 0 end)
  where p.id = new.user_id;
  return new;
end;
$$;

create trigger points_transactions_apply
  after insert on public.points_transactions
  for each row execute function private.apply_points_transaction();

-- Takes back everything a report earned its reporter (reward plus later adjustments). Safe to call twice.
create or replace function private.reverse_report_reward(p_report uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t record;
  v_net integer;
begin
  for t in
    select pt.id, pt.user_id, pt.points
    from public.points_transactions pt
    where pt.report_id = p_report and pt.transaction_type = 'report_reward'
  loop
    v_net := t.points + coalesce((
      select sum(a.points) from public.points_transactions a
      where a.related_transaction_id = t.id and a.transaction_type = 'adjustment'), 0);
    perform private.award_points(t.user_id, 'reversal', -v_net, p_report, null, p_reason, t.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Report life cycle: allowed status changes, immutable evidence, history
-- ---------------------------------------------------------------------------
create or replace function private.set_actor(p_user uuid, p_reason text)
returns void
language plpgsql set search_path = ''
as $$
begin
  perform set_config('app.actor_id', coalesce(p_user::text, ''), true);
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
end;
$$;

create or replace function private.report_before_update()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();

  if new.photo_path is distinct from old.photo_path
     or new.latitude is distinct from old.latitude
     or new.longitude is distinct from old.longitude
     or new.created_at is distinct from old.created_at then
    raise exception 'report_evidence_is_immutable' using errcode = 'check_violation';
  end if;

  if new.report_status is distinct from old.report_status and not (
       (old.report_status = 'pending_review' and new.report_status in ('active', 'rejected'))
    or (old.report_status = 'active' and new.report_status in ('cleanup_in_progress', 'pending_verification', 'rejected'))
    or (old.report_status = 'cleanup_in_progress' and new.report_status in ('active', 'pending_verification', 'rejected'))
    or (old.report_status = 'pending_verification' and new.report_status in ('cleaned', 'active', 'cleanup_in_progress', 'rejected'))
    or (old.report_status = 'rejected' and new.report_status = 'active')
  ) then
    raise exception 'invalid_status_change: % -> %', old.report_status, new.report_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger pollution_reports_before_update
  before update on public.pollution_reports
  for each row execute function private.report_before_update();

create or replace function private.report_after_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := nullif(current_setting('app.status_reason', true), '');
begin
  begin
    v_actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  exception when others then
    v_actor := null;
  end;
  v_actor := coalesce(v_actor, (select auth.uid()));
  if v_actor is not null and not exists (select 1 from public.profiles p where p.id = v_actor) then
    v_actor := null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.report_status_history (report_id, old_status, new_status, changed_by, reason)
    values (new.id, null, new.report_status, coalesce(v_actor, new.reporter_id), coalesce(v_reason, 'report_created'));
    insert into public.report_chat_rooms (report_id) values (new.id) on conflict do nothing;
  elsif new.report_status is distinct from old.report_status then
    insert into public.report_status_history (report_id, old_status, new_status, changed_by, reason)
    values (new.id, old.report_status, new.report_status, v_actor, v_reason);
  end if;
  return null;
end;
$$;

create trigger pollution_reports_after_change
  after insert or update on public.pollution_reports
  for each row execute function private.report_after_change();

-- ---------------------------------------------------------------------------
-- Reporting (server-only: called by the submit-report Edge Function with the secret key)
-- ---------------------------------------------------------------------------

-- Cheap checks done BEFORE spending an AI request.
create or replace function public.report_precheck(
  p_user uuid, p_latitude double precision, p_longitude double precision)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer := private.config_num('limits.reports_per_day', 20)::integer;
  v_radius numeric := private.config_num('duplicates.radius_m', 25);
  v_count integer;
  v_dup uuid;
  v_dlat double precision;
  v_dlng double precision;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    return jsonb_build_object('status', 'profile_missing');
  end if;
  if private.is_banned(p_user) then
    return jsonb_build_object('status', 'banned');
  end if;
  if not private.has_role(p_user, 'observer') then
    return jsonb_build_object('status', 'observer_role_required');
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180
     or (p_latitude = 0 and p_longitude = 0) then
    return jsonb_build_object('status', 'invalid_location');
  end if;

  select count(*) into v_count
  from public.pollution_reports r
  where r.reporter_id = p_user and r.created_at > now() - interval '24 hours';
  if v_count >= v_limit then
    return jsonb_build_object('status', 'rate_limited', 'limit', v_limit);
  end if;

  v_dlat := v_radius / 111320.0;
  v_dlng := v_radius / (111320.0 * greatest(cos(radians(p_latitude)), 0.01));
  select r.id into v_dup
  from public.pollution_reports r
  where r.report_status in ('pending_review', 'active', 'cleanup_in_progress', 'pending_verification')
    and r.latitude between p_latitude - v_dlat and p_latitude + v_dlat
    and r.longitude between p_longitude - v_dlng and p_longitude + v_dlng
    and private.distance_m(r.latitude, r.longitude, p_latitude, p_longitude) <= v_radius
  order by private.distance_m(r.latitude, r.longitude, p_latitude, p_longitude)
  limit 1;
  if v_dup is not null then
    return jsonb_build_object('status', 'duplicate', 'report_id', v_dup);
  end if;

  return jsonb_build_object('status', 'ok');
end;
$$;

-- Turns the AI's answer into a decision. Thresholds come from app_config.
--   accept        -> goes on the map, points awarded
--   review        -> AI thinks it is pollution but is not sure enough: moderator decides
--   not_pollution -> refused
--   unclear       -> ask for another photo
--   unavailable   -> no AI answer: fall back to the reporter's own severity
create or replace function private.decide_report(p_ai jsonb)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_conf numeric;
  v_min numeric := private.config_num('ai.min_confidence', 0.5);
  v_auto numeric := private.config_num('ai.report_auto_accept_confidence', 0.8);
begin
  if p_ai is null or jsonb_typeof(p_ai) <> 'object' then
    return 'unavailable';
  end if;
  v_conf := least(1, greatest(0, coalesce(private.safe_num(p_ai ->> 'confidence'), 0)));
  if coalesce(p_ai ->> 'image_quality', 'ok') <> 'ok' or v_conf < v_min then
    return 'unclear';
  end if;
  if coalesce(p_ai ->> 'is_pollution', 'false') <> 'true' then
    return 'not_pollution';
  end if;
  if v_conf >= v_auto then
    return 'accept';
  end if;
  return 'review';
end;
$$;

create or replace function public.submit_report(
  p_reporter uuid,
  p_photo_path text,
  p_photo_bytes integer,
  p_photo_mime text,
  p_latitude double precision,
  p_longitude double precision,
  p_address text,
  p_city text,
  p_country text,
  p_description text,
  p_user_severity text,
  p_ai jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_pre jsonb;
  v_decision text;
  v_user_sev public.severity_level := private.safe_severity(p_user_severity);
  v_ai_sev public.severity_level;
  v_cat public.pollution_category;
  v_conf numeric;
  v_status public.report_status;
  v_ai_status public.ai_analysis_status;
  v_hazard boolean := false;
  v_muni uuid;
  v_city text := private.clean_text(p_city, 80);
  v_report public.pollution_reports;
  v_points integer := 0;
begin
  v_pre := public.report_precheck(p_reporter, p_latitude, p_longitude);
  if v_pre ->> 'status' <> 'ok' then
    return v_pre;
  end if;

  -- The photo must sit in the reporter's own folder and must not have been used before.
  if p_photo_path is null
     or p_photo_path !~ ('^' || p_reporter::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then
    return jsonb_build_object('status', 'invalid_photo');
  end if;
  if exists (select 1 from public.pollution_photos ph
             where ph.bucket = 'report-photos' and ph.path = p_photo_path) then
    return jsonb_build_object('status', 'photo_already_used');
  end if;

  v_decision := private.decide_report(p_ai);
  if v_decision in ('unclear', 'not_pollution') then
    return jsonb_build_object('status', v_decision,
                              'reason', left(coalesce(p_ai ->> 'summary', ''), 300));
  end if;

  if v_decision = 'unavailable' then
    if v_user_sev is null then
      return jsonb_build_object('status', 'needs_severity');
    end if;
    v_status := 'active';
    v_ai_status := 'unavailable';
  else
    v_ai_sev := coalesce(private.safe_severity(p_ai ->> 'severity'), 'low');
    v_cat := private.safe_category(p_ai ->> 'category');
    v_conf := least(1, greatest(0, coalesce(private.safe_num(p_ai ->> 'confidence'), 0)));
    v_hazard := coalesce(p_ai ->> 'hazardous', 'false') = 'true' or v_cat = 'hazardous';
    if v_decision = 'accept' then
      v_status := 'active';
      v_ai_status := 'completed';
    else
      v_status := 'pending_review';
      v_ai_status := 'needs_review';
    end if;
  end if;

  if v_city is not null then
    select m.id into v_muni
    from public.municipalities m
    where lower(m.city) = lower(v_city)
    order by m.created_at
    limit 1;
  end if;

  perform private.set_actor(p_reporter, 'report_created');

  insert into public.pollution_reports (
    reporter_id, photo_path, latitude, longitude, address, country, city, municipality_id,
    description, user_severity, ai_category, ai_severity, ai_confidence, ai_analysis_status,
    ai_summary, ai_model, ai_analyzed_at, is_hazardous, report_status)
  values (
    p_reporter, p_photo_path, p_latitude, p_longitude,
    private.clean_text(p_address, 300), private.clean_text(p_country, 60), v_city, v_muni,
    private.clean_text(p_description, 500), v_user_sev, v_cat, v_ai_sev, v_conf, v_ai_status,
    case when p_ai is null then null else private.clean_text(p_ai ->> 'summary', 500) end,
    case when p_ai is null then null else private.clean_text(p_ai ->> 'model', 80) end,
    case when v_decision = 'unavailable' then null else now() end,
    v_hazard, v_status)
  returning * into v_report;

  insert into public.pollution_photos (report_id, uploader_id, kind, bucket, path, bytes, mime_type)
  values (v_report.id, p_reporter, 'report', 'report-photos', p_photo_path,
          case when p_photo_bytes > 0 then p_photo_bytes end,
          case when p_photo_mime in ('image/jpeg', 'image/png', 'image/webp') then p_photo_mime end);

  if v_status = 'active' then
    v_points := private.points_for('report', v_report.severity);
    if private.award_points(p_reporter, 'report_reward', v_points, v_report.id, null, 'report_accepted') is null then
      v_points := 0;
    end if;
  end if;

  return jsonb_build_object(
    'status', case when v_status = 'active' then 'created' else 'pending_review' end,
    'report_id', v_report.id,
    'points', v_points,
    'severity', v_report.severity,
    'category', v_report.ai_category,
    'hazardous', v_report.is_hazardous,
    'ai_used', v_decision <> 'unavailable');
end;
$$;

-- Later, when the AI is reachable again, reports saved without it are checked.
create or replace function public.apply_report_reanalysis(p_report_id uuid, p_ai jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.pollution_reports;
  v_decision text;
  v_sev public.severity_level;
  v_cat public.pollution_category;
  v_conf numeric;
  v_reward record;
  v_current integer;
  v_target integer;
begin
  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if r.ai_analysis_status <> 'unavailable' then
    return jsonb_build_object('status', 'skipped');
  end if;

  v_decision := private.decide_report(p_ai);
  if v_decision = 'unavailable' then
    return jsonb_build_object('status', 'still_unavailable');
  end if;

  v_sev := private.safe_severity(p_ai ->> 'severity');
  v_cat := private.safe_category(p_ai ->> 'category');
  v_conf := least(1, greatest(0, coalesce(private.safe_num(p_ai ->> 'confidence'), 0)));

  if v_decision <> 'accept' then
    -- The AI disagrees or is unsure: a moderator decides, nothing is taken away automatically.
    update public.pollution_reports pr set
      ai_analysis_status = 'needs_review',
      ai_confidence = v_conf,
      ai_summary = private.clean_text(p_ai ->> 'summary', 500),
      ai_model = private.clean_text(p_ai ->> 'model', 80),
      ai_analyzed_at = now()
    where pr.id = r.id;
    return jsonb_build_object('status', 'needs_review', 'decision', v_decision);
  end if;

  v_sev := coalesce(v_sev, r.user_severity, 'low');
  update public.pollution_reports pr set
    ai_category = v_cat,
    ai_severity = v_sev,
    ai_confidence = v_conf,
    ai_analysis_status = 'completed',
    ai_summary = private.clean_text(p_ai ->> 'summary', 500),
    ai_model = private.clean_text(p_ai ->> 'model', 80),
    ai_analyzed_at = now(),
    is_hazardous = pr.is_hazardous or coalesce(p_ai ->> 'hazardous', 'false') = 'true' or v_cat = 'hazardous'
  where pr.id = r.id;

  -- If the AI's severity differs from the reporter's guess, correct the points once.
  select pt.id, pt.user_id, pt.points into v_reward
  from public.points_transactions pt
  where pt.report_id = r.id and pt.transaction_type = 'report_reward'
  limit 1;
  if found and v_reward.user_id is not null
     and not exists (select 1 from public.points_transactions x
                     where x.related_transaction_id = v_reward.id and x.transaction_type = 'reversal') then
    v_current := v_reward.points + coalesce((
      select sum(a.points) from public.points_transactions a
      where a.related_transaction_id = v_reward.id and a.transaction_type = 'adjustment'), 0);
    v_target := private.points_for('report', v_sev);
    if v_target <> v_current then
      perform private.award_points(v_reward.user_id, 'adjustment', v_target - v_current,
                                   r.id, null, 'ai_reanalysis', v_reward.id);
    end if;
  end if;

  return jsonb_build_object('status', 'updated', 'severity', v_sev, 'category', v_cat);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cleanups
-- ---------------------------------------------------------------------------
create or replace function public.join_cleanup(p_report_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.pollution_reports;
  v_new boolean := false;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if private.is_banned(v_uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if not private.has_role(v_uid, 'activist') then
    raise exception 'activist_role_required' using errcode = '42501';
  end if;

  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if r.is_hazardous then
    raise exception 'hazardous_report' using errcode = 'P0001';
  end if;
  if r.report_status not in ('active', 'cleanup_in_progress') then
    raise exception 'report_not_open' using errcode = 'P0001';
  end if;

  insert into public.cleanup_participants (report_id, user_id)
  values (p_report_id, v_uid)
  on conflict do nothing;
  v_new := found;

  if r.report_status = 'active' then
    perform private.set_actor(v_uid, 'cleanup_joined');
    update public.pollution_reports pr set report_status = 'cleanup_in_progress' where pr.id = p_report_id;
  end if;

  if v_new and r.reporter_id is distinct from v_uid then
    perform private.notify(r.reporter_id, 'cleanup_joined', r.id, jsonb_build_object('user_id', v_uid));
  end if;

  return jsonb_build_object('status', 'joined');
end;
$$;

create or replace function public.leave_cleanup(p_report_id uuid)
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

  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if r.report_status = 'pending_verification' then
    raise exception 'cleanup_awaiting_verification' using errcode = 'P0001';
  end if;

  delete from public.cleanup_participants cp where cp.report_id = p_report_id and cp.user_id = v_uid;

  if r.report_status = 'cleanup_in_progress'
     and not exists (select 1 from public.cleanup_participants cp where cp.report_id = p_report_id) then
    perform private.set_actor(v_uid, 'cleanup_left');
    update public.pollution_reports pr set report_status = 'active' where pr.id = p_report_id;
  end if;

  return jsonb_build_object('status', 'left');
end;
$$;

-- Server-only: checks done before the AI compares the photos.
create or replace function public.cleanup_precheck(
  p_user uuid, p_report_id uuid, p_latitude double precision, p_longitude double precision)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.pollution_reports;
  v_limit integer := private.config_num('limits.cleanups_per_day', 20)::integer;
  v_max_distance numeric := private.config_num('cleanup.max_distance_m', 300);
  v_distance double precision;
  v_count integer;
begin
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
    return jsonb_build_object('status', 'profile_missing');
  end if;
  if private.is_banned(p_user) then
    return jsonb_build_object('status', 'banned');
  end if;
  if not private.has_role(p_user, 'activist') then
    return jsonb_build_object('status', 'activist_role_required');
  end if;

  select * into r from public.pollution_reports pr where pr.id = p_report_id;
  if not found then
    return jsonb_build_object('status', 'report_not_found');
  end if;
  if r.is_hazardous then
    return jsonb_build_object('status', 'hazardous_report');
  end if;
  if r.report_status not in ('active', 'cleanup_in_progress') then
    return jsonb_build_object('status', 'report_not_open', 'report_status', r.report_status);
  end if;
  if exists (select 1 from public.cleanup_submissions s
             where s.report_id = p_report_id and s.verification_status in ('pending', 'manual_review')) then
    return jsonb_build_object('status', 'already_submitted');
  end if;

  select count(*) into v_count
  from public.cleanup_submissions s
  where s.activist_id = p_user and s.submitted_at > now() - interval '24 hours';
  if v_count >= v_limit then
    return jsonb_build_object('status', 'rate_limited', 'limit', v_limit);
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return jsonb_build_object('status', 'location_required');
  end if;
  v_distance := private.distance_m(r.latitude, r.longitude, p_latitude, p_longitude);
  if v_distance > v_max_distance then
    return jsonb_build_object('status', 'too_far', 'distance_m', round(v_distance), 'max_distance_m', v_max_distance);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'before_photo_path', r.photo_path,
    'severity', r.severity,
    'distance_m', round(v_distance));
end;
$$;

-- Marks the report cleaned and pays everyone who took part. Called for AI approvals and moderator approvals.
create or replace function private.finalize_cleanup(
  p_submission_id uuid, p_status public.verification_status, p_moderator uuid, p_note text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s public.cleanup_submissions;
  r public.pollution_reports;
  v_after_path text;
  v_points integer;
  v_user uuid;
begin
  if p_status not in ('ai_approved', 'moderator_approved') then
    raise exception 'invalid_final_status' using errcode = 'P0001';
  end if;

  select * into s from public.cleanup_submissions cs where cs.id = p_submission_id for update;
  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  if s.verification_status not in ('pending', 'manual_review') then
    raise exception 'submission_already_decided' using errcode = 'P0001';
  end if;
  select * into r from public.pollution_reports pr where pr.id = s.report_id for update;
  if r.report_status <> 'pending_verification' then
    raise exception 'report_not_awaiting_verification' using errcode = 'P0001';
  end if;

  select ph.path into v_after_path from public.pollution_photos ph where ph.id = s.after_photo_id;

  update public.cleanup_submissions cs set
    verification_status = p_status,
    moderator_id = p_moderator,
    moderator_note = private.clean_text(p_note, 500),
    verified_at = now()
  where cs.id = s.id;

  perform private.set_actor(coalesce(p_moderator, s.activist_id), 'cleanup_verified');
  update public.pollution_reports pr set
    report_status = 'cleaned',
    cleaned_at = now(),
    cleaned_photo_path = v_after_path
  where pr.id = r.id;

  -- Points are paid only now, after verification, once per person.
  v_points := private.points_for('cleanup', r.severity);
  for v_user in
    select s.activist_id where s.activist_id is not null
    union
    select cp.user_id from public.cleanup_participants cp
    where cp.report_id = r.id and cp.joined_at <= s.submitted_at
  loop
    if private.award_points(v_user, 'cleanup_reward', v_points, r.id, s.id, 'cleanup_verified') is not null then
      perform private.notify(v_user, 'cleanup_approved', r.id,
                             jsonb_build_object('points', v_points, 'submission_id', s.id));
    end if;
  end loop;

  if r.reporter_id is not null and r.reporter_id is distinct from s.activist_id then
    perform private.notify(r.reporter_id, 'report_cleaned', r.id, jsonb_build_object('submission_id', s.id));
  end if;

  return v_points;
end;
$$;

create or replace function private.reject_cleanup(
  p_submission_id uuid, p_moderator uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.cleanup_submissions;
begin
  select * into s from public.cleanup_submissions cs where cs.id = p_submission_id for update;
  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  if s.verification_status not in ('pending', 'manual_review') then
    raise exception 'submission_already_decided' using errcode = 'P0001';
  end if;

  update public.cleanup_submissions cs set
    verification_status = 'rejected',
    moderator_id = p_moderator,
    moderator_note = private.clean_text(p_note, 500),
    verified_at = now()
  where cs.id = s.id;

  -- The pollution is still there: reopen the report.
  perform private.set_actor(coalesce(p_moderator, s.activist_id), 'cleanup_rejected');
  update public.pollution_reports pr set
    report_status = case
      when exists (select 1 from public.cleanup_participants cp where cp.report_id = pr.id)
        then 'cleanup_in_progress'::public.report_status
      else 'active'::public.report_status end
  where pr.id = s.report_id and pr.report_status = 'pending_verification';

  perform private.notify(s.activist_id, 'cleanup_rejected', s.report_id,
                         jsonb_build_object('submission_id', s.id, 'note', private.clean_text(p_note, 500)));
end;
$$;

-- Server-only: called by the submit-cleanup Edge Function after the AI compared before/after.
--   p_ai = null                               -> AI unavailable: a moderator decides
--   p_ai = {is_clean, same_location, confidence, summary, model}
create or replace function public.submit_cleanup(
  p_user uuid,
  p_report_id uuid,
  p_after_path text,
  p_after_bytes integer,
  p_after_mime text,
  p_latitude double precision,
  p_longitude double precision,
  p_ai jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_pre jsonb;
  r public.pollution_reports;
  v_after_id uuid;
  v_before_id uuid;
  v_sub_id uuid;
  v_conf numeric;
  v_clean boolean;
  v_same boolean;
  v_auto numeric := private.config_num('ai.cleanup_auto_verify_confidence', 0.85);
  v_max_auto integer := private.config_num('cleanup.max_auto_participants', 5)::integer;
  v_self_review boolean := private.config_bool('cleanup.self_clean_requires_review', true);
  v_force_review boolean;
  v_decision text;
  v_participants integer;
  v_points integer := 0;
begin
  v_pre := public.cleanup_precheck(p_user, p_report_id, p_latitude, p_longitude);
  if v_pre ->> 'status' <> 'ok' then
    return v_pre;
  end if;

  if p_after_path is null
     or p_after_path !~ ('^' || p_user::text || '/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$') then
    return jsonb_build_object('status', 'invalid_photo');
  end if;
  if exists (select 1 from public.pollution_photos ph
             where ph.bucket = 'cleanup-photos' and ph.path = p_after_path) then
    return jsonb_build_object('status', 'photo_already_used');
  end if;

  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if r.report_status not in ('active', 'cleanup_in_progress') then
    return jsonb_build_object('status', 'report_not_open', 'report_status', r.report_status);
  end if;

  -- The person submitting always counts as a participant.
  insert into public.cleanup_participants (report_id, user_id)
  values (p_report_id, p_user)
  on conflict do nothing;
  select count(*) into v_participants from public.cleanup_participants cp where cp.report_id = p_report_id;

  insert into public.pollution_photos (report_id, uploader_id, kind, bucket, path, bytes, mime_type)
  values (p_report_id, p_user, 'cleanup_after', 'cleanup-photos', p_after_path,
          case when p_after_bytes > 0 then p_after_bytes end,
          case when p_after_mime in ('image/jpeg', 'image/png', 'image/webp') then p_after_mime end)
  returning id into v_after_id;

  select ph.id into v_before_id
  from public.pollution_photos ph
  where ph.report_id = p_report_id and ph.kind = 'report'
  order by ph.created_at
  limit 1;

  -- Decision
  v_force_review := p_ai is null
    or jsonb_typeof(p_ai) <> 'object'
    or (v_self_review and r.reporter_id = p_user)
    or v_participants > v_max_auto;
  v_conf := case when p_ai is null then null
                 else least(1, greatest(0, coalesce(private.safe_num(p_ai ->> 'confidence'), 0))) end;
  v_clean := coalesce(p_ai ->> 'is_clean', 'false') = 'true';
  v_same := coalesce(p_ai ->> 'same_location', 'false') = 'true';

  if p_ai is not null and v_conf >= v_auto and not v_clean then
    v_decision := 'rejected';          -- the AI is confident the pollution is still there
  elsif not v_force_review and v_clean and v_same and v_conf >= v_auto then
    v_decision := 'ai_approved';
  else
    v_decision := 'manual_review';
  end if;

  insert into public.cleanup_submissions (
    report_id, activist_id, before_photo_id, after_photo_id, distance_m,
    ai_verification_result, ai_confidence, verification_status)
  values (
    p_report_id, p_user, v_before_id, v_after_id, (v_pre ->> 'distance_m')::integer,
    p_ai, v_conf,
    case when v_decision = 'manual_review' then 'manual_review'::public.verification_status
         else 'pending'::public.verification_status end)
  returning id into v_sub_id;

  perform private.set_actor(p_user, 'cleanup_submitted');
  update public.pollution_reports pr set report_status = 'pending_verification' where pr.id = p_report_id;

  if v_decision = 'ai_approved' then
    v_points := private.finalize_cleanup(v_sub_id, 'ai_approved', null, null);
  elsif v_decision = 'rejected' then
    perform private.reject_cleanup(v_sub_id, null, 'ai_rejected');
  else
    if r.reporter_id is distinct from p_user then
      perform private.notify(r.reporter_id, 'cleanup_submitted', p_report_id,
                             jsonb_build_object('submission_id', v_sub_id));
    end if;
  end if;

  return jsonb_build_object(
    'status', case v_decision when 'ai_approved' then 'approved' else v_decision end,
    'submission_id', v_sub_id,
    'points', v_points,
    'reason', left(coalesce(p_ai ->> 'summary', ''), 300),
    'ai_used', p_ai is not null);
exception
  when unique_violation then
    return jsonb_build_object('status', 'already_submitted');
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation (user RPCs; every call checks that the caller is staff for that report)
-- ---------------------------------------------------------------------------
create or replace function public.moderate_cleanup(
  p_submission_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.cleanup_submissions;
  v_points integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into s from public.cleanup_submissions cs where cs.id = p_submission_id;
  if not found then
    raise exception 'submission_not_found' using errcode = 'P0002';
  end if;
  if not private.can_moderate_report(s.report_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Nobody verifies a cleanup they took part in.
  if s.activist_id = v_uid or exists (
       select 1 from public.cleanup_participants cp
       where cp.report_id = s.report_id and cp.user_id = v_uid) then
    raise exception 'cannot_verify_own_cleanup' using errcode = '42501';
  end if;

  if p_approve then
    v_points := private.finalize_cleanup(p_submission_id, 'moderator_approved', v_uid, p_note);
  else
    perform private.reject_cleanup(p_submission_id, v_uid, p_note);
  end if;

  insert into public.moderation_logs (moderator_id, action, target_type, target_id, note, metadata)
  values (v_uid, case when p_approve then 'cleanup_approved' else 'cleanup_rejected' end,
          'cleanup_submission', p_submission_id, private.clean_text(p_note, 500),
          jsonb_build_object('report_id', s.report_id, 'points', v_points));

  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'points', v_points);
end;
$$;

create or replace function public.moderate_report(
  p_report_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.pollution_reports;
  v_points integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('approve', 'reject') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  if not private.can_moderate_report(p_report_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into r from public.pollution_reports pr where pr.id = p_report_id for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  perform private.set_actor(v_uid, 'moderation_' || p_action);

  if p_action = 'approve' then
    if r.reporter_id = v_uid then
      raise exception 'cannot_approve_own_report' using errcode = '42501';
    end if;
    if r.report_status = 'pending_review' then
      update public.pollution_reports pr set
        report_status = 'active',
        ai_analysis_status = case when pr.ai_analysis_status = 'needs_review'
                                  then 'completed'::public.ai_analysis_status else pr.ai_analysis_status end,
        reviewed_by = v_uid,
        reviewed_at = now()
      where pr.id = r.id
      returning * into r;
      v_points := private.points_for('report', r.severity);
      if private.award_points(r.reporter_id, 'report_reward', v_points, r.id, null, 'report_approved') is null then
        v_points := 0;
      end if;
      perform private.notify(r.reporter_id, 'report_approved', r.id, jsonb_build_object('points', v_points));
    elsif r.ai_analysis_status = 'needs_review' and r.report_status <> 'rejected' then
      update public.pollution_reports pr set
        ai_analysis_status = 'completed', reviewed_by = v_uid, reviewed_at = now()
      where pr.id = r.id;
    else
      raise exception 'nothing_to_approve' using errcode = 'P0001';
    end if;
  else
    if r.report_status in ('cleaned', 'rejected') then
      raise exception 'report_already_closed' using errcode = 'P0001';
    end if;
    -- Close anything still open on this report first.
    update public.cleanup_submissions cs set
      verification_status = 'rejected', moderator_id = v_uid,
      moderator_note = 'report_rejected', verified_at = now()
    where cs.report_id = r.id and cs.verification_status in ('pending', 'manual_review');
    delete from public.cleanup_participants cp where cp.report_id = r.id;

    update public.pollution_reports pr set
      report_status = 'rejected', reviewed_by = v_uid, reviewed_at = now()
    where pr.id = r.id;
    perform private.reverse_report_reward(r.id, 'report_rejected');
    perform private.notify(r.reporter_id, 'report_rejected', r.id,
                           jsonb_build_object('note', private.clean_text(p_note, 500)));
  end if;

  insert into public.moderation_logs (moderator_id, action, target_type, target_id, note, metadata)
  values (v_uid, 'report_' || p_action, 'report', p_report_id, private.clean_text(p_note, 500),
          jsonb_build_object('points', v_points));

  return jsonb_build_object('status', 'ok', 'action', p_action, 'points', v_points);
end;
$$;

-- ---------------------------------------------------------------------------
-- Account-level user RPCs
-- ---------------------------------------------------------------------------
create or replace function public.set_my_roles(p_roles text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'at_least_one_role_required' using errcode = 'P0001';
  end if;
  foreach v_role in array p_roles loop
    if v_role is null or v_role not in ('observer', 'activist') then
      raise exception 'invalid_role' using errcode = 'P0001';
    end if;
  end loop;

  delete from public.user_roles ur
  where ur.user_id = v_uid and not (ur.role::text = any (p_roles));
  insert into public.user_roles (user_id, role)
  select v_uid, x::public.app_role from unnest(p_roles) as x
  on conflict do nothing;

  return jsonb_build_object('roles', (
    select jsonb_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = v_uid));
end;
$$;

create or replace function public.get_my_rank()
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when p.leaderboard_hidden then null else (
    select count(*)::integer + 1
    from public.profiles o
    where not o.leaderboard_hidden and o.total_points > p.total_points) end
  from public.profiles p
  where p.id = (select auth.uid());
$$;

create or replace function public.mark_notifications_read()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.notifications n set read_at = now()
  where n.user_id = v_uid and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------
create or replace function private.chat_message_before_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_limit integer := private.config_num('limits.chat_messages_per_minute', 12)::integer;
  v_count integer;
begin
  if new.sender_id is null then
    raise exception 'sender_required' using errcode = 'P0001';
  end if;
  if private.is_banned(new.sender_id) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select count(*) into v_count
  from public.chat_messages m
  where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute';
  if v_count >= v_limit then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  new.body := btrim(new.body);
  new.created_at := now();
  new.deleted_at := null;
  new.deleted_by := null;
  return new;
end;
$$;

create trigger chat_messages_before_insert
  before insert on public.chat_messages
  for each row execute function private.chat_message_before_insert();

-- The sender or a moderator can remove a message (soft delete, kept for the audit trail).
create or replace function public.delete_chat_message(p_message_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m public.chat_messages;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into m from public.chat_messages cm where cm.id = p_message_id for update;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  if m.sender_id is distinct from v_uid and not private.is_moderator() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.chat_messages cm set deleted_at = now(), deleted_by = v_uid
  where cm.id = p_message_id and cm.deleted_at is null;
  if m.sender_id is distinct from v_uid then
    insert into public.moderation_logs (moderator_id, action, target_type, target_id)
    values (v_uid, 'chat_message_deleted', 'chat_message', p_message_id);
  end if;
end;
$$;
