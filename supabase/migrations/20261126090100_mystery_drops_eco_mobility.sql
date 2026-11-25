-- EcoMap 7b: Gizli Hazine (mystery drops), Eko-Ulaşım (walking + bikes), camera capture metadata.
-- All points are computed here, never in the app. Refusals use SQLSTATE 42501 (HTTP 403 to the app).

-- ---------------------------------------------------------------------------
-- Shared
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'report_approved', 'report_rejected', 'report_cleaned', 'cleanup_joined', 'cleanup_submitted',
  'cleanup_approved', 'cleanup_rejected', 'points_awarded', 'system', 'report_status', 'report_supported',
  'report_assigned', 'points_adjusted', 'reward_redeemed', 'mystery_drop', 'eco_points'));

-- "Today" for daily limits is the Turkish calendar day.
create or replace function private.eco_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Europe/Istanbul')::date;
$$;

insert into public.app_config (key, value, description) values
  ('eco.walk.steps_per_reward', '3000', 'Steps for one walking reward'),
  ('eco.walk.points_per_reward', '20', 'EcoPuan per walking reward'),
  ('eco.walk.daily_cap', '100', 'Maximum walking EcoPuan per day'),
  ('eco.walk.max_steps_per_day', '60000', 'Steps above this are ignored (anti-abuse)'),
  ('eco.walk.meters_per_step', '0.75', 'Average step length used for distance'),
  ('eco.bike.minutes_per_reward', '15', 'Riding minutes for one bike reward'),
  ('eco.bike.km_per_reward', '3', 'Riding kilometres for one bike reward'),
  ('eco.bike.points_per_reward', '30', 'EcoPuan per bike reward'),
  ('eco.bike.daily_cap', '120', 'Maximum bike EcoPuan per day'),
  ('eco.bike.max_speed_kmh', '35', 'Distance above this average speed is cut (anti-abuse)'),
  ('eco.bike.min_speed_kmh', '4', 'Riding time only counts when the average speed reaches this'),
  ('eco.co2_g_per_km', '120', 'Estimated car CO2 avoided per km (grams)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Gizli Hazine — mystery drops
-- ---------------------------------------------------------------------------
create table if not exists public.mystery_drops (
  id uuid primary key default gen_random_uuid(),
  municipality_id uuid references public.municipalities (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 80),
  description text check (description is null or char_length(description) <= 300),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null check (radius_m between 50 and 5000),
  reward_mode text not null check (reward_mode in ('multiplier', 'bonus')),
  multiplier numeric(3, 1) check (multiplier is null or multiplier between 1.5 and 5),
  bonus_points integer check (bonus_points is null or bonus_points between 5 and 500),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_early_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint mystery_drops_value check (
    (reward_mode = 'multiplier' and multiplier is not null) or (reward_mode = 'bonus' and bonus_points is not null)),
  constraint mystery_drops_window check (ends_at > starts_at and ends_at <= starts_at + interval '7 days')
);
create index if not exists mystery_drops_ends_idx on public.mystery_drops (ends_at desc);
alter table public.mystery_drops enable row level security;

alter table public.points_transactions
  add column if not exists mystery_drop_id uuid references public.mystery_drops (id) on delete set null;
create unique index if not exists points_one_mystery_bonus_idx on public.points_transactions (related_transaction_id)
  where transaction_type = 'mystery_bonus';

create or replace function private.drop_label(d public.mystery_drops)
returns text
language sql immutable set search_path = ''
as $$
  select case when d.reward_mode = 'multiplier'
    then (case when d.multiplier = trunc(d.multiplier) then trunc(d.multiplier)::int::text
               else replace(d.multiplier::text, '.', ',') end) || 'x'
    else '+' || d.bonus_points || ' EC' end;
$$;

-- The drop (if any) that covered this place at this moment; the most generous one wins.
create or replace function private.drop_at(p_lat double precision, p_lng double precision, p_at timestamptz)
returns public.mystery_drops
language sql stable security definer set search_path = ''
as $$
  select d.* from public.mystery_drops d
  where p_at >= d.starts_at and p_at < coalesce(d.ended_early_at, d.ends_at)
    and private.distance_m(d.latitude, d.longitude, p_lat, p_lng) <= d.radius_m
  order by coalesce(d.multiplier, 1) desc, coalesce(d.bonus_points, 0) desc
  limit 1;
$$;

-- After a report/cleanup reward: add the drop bonus. After a reversal of that reward: reverse the bonus too.
-- The drop is judged at the moment of the contribution (report sent / cleanup submitted), so a
-- moderator approving it later does not make the citizen lose the bonus.
create or replace function private.apply_mystery_bonus()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r public.pollution_reports;
  d public.mystery_drops;
  v_at timestamptz;
  v_bonus integer;
  b record;
begin
  if new.user_id is null then
    return new;
  end if;

  if new.transaction_type in ('report_reward', 'cleanup_reward') and new.points > 0 and new.report_id is not null then
    select * into r from public.pollution_reports pr where pr.id = new.report_id;
    if not found then
      return new;
    end if;
    v_at := r.created_at;
    if new.transaction_type = 'cleanup_reward' and new.cleanup_submission_id is not null then
      select cs.submitted_at into v_at from public.cleanup_submissions cs where cs.id = new.cleanup_submission_id;
    end if;
    d := private.drop_at(r.latitude, r.longitude, coalesce(v_at, new.created_at));
    if d.id is null then
      return new;
    end if;
    v_bonus := case when d.reward_mode = 'multiplier'
                    then round(new.points * (d.multiplier - 1))::int
                    else d.bonus_points end;
    if v_bonus > 0 then
      insert into public.points_transactions
        (user_id, report_id, cleanup_submission_id, transaction_type, points, reason, related_transaction_id, mystery_drop_id)
      values (new.user_id, new.report_id, new.cleanup_submission_id, 'mystery_bonus', v_bonus,
              left('Gizli Hazine ' || private.drop_label(d) || ' Bonusu: ' || d.title, 200), new.id, d.id)
      on conflict do nothing;
    end if;

  elsif new.transaction_type = 'reversal' and new.related_transaction_id is not null then
    for b in
      select pt.id, pt.user_id, pt.points, pt.report_id from public.points_transactions pt
      where pt.related_transaction_id = new.related_transaction_id and pt.transaction_type = 'mystery_bonus'
        and not exists (select 1 from public.points_transactions x
                        where x.related_transaction_id = pt.id and x.transaction_type = 'reversal')
    loop
      insert into public.points_transactions (user_id, report_id, transaction_type, points, reason, related_transaction_id)
      values (b.user_id, b.report_id, 'reversal', -b.points, 'Gizli Hazine bonusu iptal', b.id)
      on conflict do nothing;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists points_transactions_mystery_bonus on public.points_transactions;
create trigger points_transactions_mystery_bonus
  after insert on public.points_transactions
  for each row execute function private.apply_mystery_bonus();

-- Admin: open a drop. p_value = multiplier (1.5–5) or bonus points (5–500); p_duration_hours 1–168.
create or replace function public.muni_create_mystery_drop(
  p_title text, p_description text, p_latitude double precision, p_longitude double precision,
  p_radius_m integer, p_reward_mode text, p_value numeric, p_duration_hours integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_muni uuid;
  v_city text;
  d public.mystery_drops;
  v_notified integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.is_points_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_duration_hours is null or p_duration_hours not between 1 and 168 then
    raise exception 'invalid_duration' using errcode = 'P0001';
  end if;
  if p_reward_mode not in ('multiplier', 'bonus') or p_value is null
     or (p_reward_mode = 'multiplier' and p_value not between 1.5 and 5)
     or (p_reward_mode = 'bonus' and (p_value not between 5 and 500 or p_value <> trunc(p_value))) then
    raise exception 'invalid_reward' using errcode = 'P0001';
  end if;

  -- The municipality whose area holds the point, else the admin's own municipality.
  select m.id, m.city into v_muni, v_city from public.municipalities m
  where m.min_lat is not null and p_latitude between m.min_lat and m.max_lat and p_longitude between m.min_lng and m.max_lng
  order by (m.max_lat - m.min_lat) * (m.max_lng - m.min_lng) limit 1;
  if v_muni is null then
    select m.id, m.city into v_muni, v_city from public.municipalities m
    where m.id in (select private.my_municipality_ids()) limit 1;
  end if;

  insert into public.mystery_drops
    (municipality_id, created_by, title, description, latitude, longitude, radius_m, reward_mode,
     multiplier, bonus_points, starts_at, ends_at)
  values (v_muni, v_uid, private.clean_text(p_title, 80), private.clean_text(p_description, 300),
          p_latitude, p_longitude, p_radius_m, p_reward_mode,
          case when p_reward_mode = 'multiplier' then round(p_value, 1) end,
          case when p_reward_mode = 'bonus' then p_value::int end,
          now(), now() + make_interval(hours => p_duration_hours))
  returning * into d;

  -- In-app notice for everyone who lives in that city (the app also sends a local push to people nearby).
  if v_city is not null then
    insert into public.notifications (user_id, type, data)
    select p.id, 'mystery_drop', jsonb_build_object(
      'drop_id', d.id, 'title', d.title, 'label', private.drop_label(d), 'ends_at', d.ends_at)
    from public.profiles p
    where lower(coalesce(p.city, '')) = lower(v_city) and p.id <> v_uid
    limit 20000;
    get diagnostics v_notified = row_count;
  end if;

  return jsonb_build_object('status', 'ok', 'id', d.id, 'label', private.drop_label(d),
                            'ends_at', d.ends_at, 'notified', v_notified);
end;
$$;

create or replace function public.muni_end_mystery_drop(p_drop_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.is_points_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.mystery_drops d set ended_early_at = now(), ended_by = v_uid
  where d.id = p_drop_id and d.ended_early_at is null and d.ends_at > now();
  if not found then
    raise exception 'drop_not_active' using errcode = 'P0001';
  end if;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Eko-Ulaşım — walking and municipal bikes
-- ---------------------------------------------------------------------------
create table if not exists public.eco_mobility_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('walk', 'bike')),
  steps integer not null default 0 check (steps >= 0),
  distance_m integer not null default 0 check (distance_m >= 0),
  points_awarded integer not null default 0 check (points_awarded >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, day, kind)
);
alter table public.eco_mobility_logs enable row level security;

create table if not exists public.bike_rides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bike_code text not null check (bike_code ~ '^[A-Z0-9-]{2,20}$'),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  source text not null default 'app' check (source in ('app', 'municipal_system')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_lat double precision, start_lng double precision,
  end_lat double precision, end_lng double precision,
  reported_distance_m integer check (reported_distance_m is null or reported_distance_m >= 0),
  distance_m integer check (distance_m is null or distance_m >= 0),
  duration_s integer check (duration_s is null or duration_s >= 0),
  points_awarded integer not null default 0,
  transaction_id uuid references public.points_transactions (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists bike_rides_one_active_idx on public.bike_rides (user_id) where status = 'active';
create index if not exists bike_rides_user_idx on public.bike_rides (user_id, started_at desc);
alter table public.bike_rides enable row level security;

-- Adds walking steps for today. The phone sends its step count for today; the server keeps the
-- highest plausible value, turns it into points and never goes over the daily cap.
create or replace function public.sync_walk_steps(p_steps integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_day date := private.eco_today();
  v_day_start timestamptz := (private.eco_today()::timestamp at time zone 'Europe/Istanbul');
  v_per integer := private.config_num('eco.walk.steps_per_reward', 3000)::int;
  v_pts integer := private.config_num('eco.walk.points_per_reward', 20)::int;
  v_cap integer := private.config_num('eco.walk.daily_cap', 100)::int;
  v_max integer := private.config_num('eco.walk.max_steps_per_day', 60000)::int;
  v_mps numeric := private.config_num('eco.walk.meters_per_step', 0.75);
  l public.eco_mobility_logs;
  v_since numeric;
  v_steps integer;
  v_target integer;
  v_delta integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if private.is_banned(v_uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if p_steps is null or p_steps < 0 then
    raise exception 'invalid_steps' using errcode = 'P0001';
  end if;

  insert into public.eco_mobility_logs (user_id, day, kind, updated_at)
  values (v_uid, v_day, 'walk', v_day_start) on conflict (user_id, day, kind) do nothing;
  select * into l from public.eco_mobility_logs e
  where e.user_id = v_uid and e.day = v_day and e.kind = 'walk' for update;

  -- At most ~3 steps per second since the last sync (or since midnight), plus a small margin.
  v_since := greatest(0, extract(epoch from now() - l.updated_at));
  v_steps := greatest(l.steps, least(p_steps, l.steps + (v_since * 3)::int + 500, v_max));
  v_target := least(v_cap, (v_steps / v_per) * v_pts);
  v_delta := v_target - l.points_awarded;

  if v_delta > 0 then
    insert into public.points_transactions (user_id, transaction_type, points, reason)
    values (v_uid, 'eco_walk', v_delta, 'Eko-Ulaşım: Yürüyüş');
  end if;

  update public.eco_mobility_logs e set
    steps = v_steps,
    distance_m = round(v_steps * v_mps)::int,
    points_awarded = greatest(l.points_awarded, v_target),
    updated_at = now()
  where e.id = l.id;

  return jsonb_build_object(
    'day', v_day, 'steps', v_steps, 'accepted_steps', v_steps, 'distance_m', round(v_steps * v_mps)::int,
    'points_today', greatest(l.points_awarded, v_target), 'points_added', greatest(v_delta, 0),
    'daily_cap', v_cap, 'steps_per_reward', v_per, 'points_per_reward', v_pts,
    'next_reward_steps', case when v_target >= v_cap then null else ((v_steps / v_per) + 1) * v_per end,
    'co2_saved_g', round(v_steps * v_mps / 1000 * private.config_num('eco.co2_g_per_km', 120)));
end;
$$;

-- Shared by the in-app flow and the municipal rental system: turn a finished ride into points.
create or replace function private.complete_bike_ride(p_ride_id uuid, p_distance_m integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  b public.bike_rides;
  v_end timestamptz;
  v_duration integer;
  v_max_dist integer;
  v_straight integer := 0;
  v_dist integer;
  v_speed numeric;
  v_units integer;
  v_raw integer;
  v_day date := private.eco_today();
  v_cap integer := private.config_num('eco.bike.daily_cap', 120)::int;
  v_pts integer := private.config_num('eco.bike.points_per_reward', 30)::int;
  v_done integer;
  v_award integer;
  v_tx uuid;
begin
  select * into b from public.bike_rides r where r.id = p_ride_id for update;
  v_end := coalesce(b.ended_at, now());
  v_duration := greatest(0, extract(epoch from v_end - b.started_at))::int;
  v_max_dist := (v_duration * private.config_num('eco.bike.max_speed_kmh', 35) / 3.6)::int;
  if b.start_lat is not null and b.end_lat is not null then
    v_straight := private.distance_m(b.start_lat, b.start_lng, b.end_lat, b.end_lng)::int;
  end if;
  v_dist := least(greatest(coalesce(p_distance_m, 0), v_straight), v_max_dist);
  v_speed := case when v_duration > 0 then v_dist / v_duration::numeric * 3.6 else 0 end;

  if v_duration < 60 then
    update public.bike_rides r set status = 'cancelled', ended_at = v_end, duration_s = v_duration,
      distance_m = v_dist, reported_distance_m = p_distance_m where r.id = b.id;
    return jsonb_build_object('status', 'too_short', 'duration_s', v_duration, 'points', 0);
  end if;

  -- Every 15 minutes (only while really moving) or every 3 km, whichever gives more.
  v_units := greatest(
    case when v_speed >= private.config_num('eco.bike.min_speed_kmh', 4)
         then v_duration / (private.config_num('eco.bike.minutes_per_reward', 15) * 60)::int else 0 end,
    (v_dist / (private.config_num('eco.bike.km_per_reward', 3) * 1000))::int);
  v_raw := v_units * v_pts;

  insert into public.eco_mobility_logs (user_id, day, kind) values (b.user_id, v_day, 'bike')
  on conflict (user_id, day, kind) do nothing;
  select e.points_awarded into v_done from public.eco_mobility_logs e
  where e.user_id = b.user_id and e.day = v_day and e.kind = 'bike' for update;
  v_award := greatest(0, least(v_raw, v_cap - v_done));

  if v_award > 0 then
    insert into public.points_transactions (user_id, transaction_type, points, reason)
    values (b.user_id, 'eco_bike', v_award, 'Eko-Ulaşım: Bisiklet Sürüşü')
    returning id into v_tx;
  end if;

  update public.eco_mobility_logs e set
    distance_m = e.distance_m + v_dist, points_awarded = e.points_awarded + v_award, updated_at = now()
  where e.user_id = b.user_id and e.day = v_day and e.kind = 'bike';

  update public.bike_rides r set status = 'completed', ended_at = v_end, duration_s = v_duration,
    distance_m = v_dist, reported_distance_m = p_distance_m, points_awarded = v_award, transaction_id = v_tx
  where r.id = b.id;

  return jsonb_build_object(
    'status', 'completed', 'ride_id', b.id, 'duration_s', v_duration, 'distance_m', v_dist,
    'points', v_award, 'points_before_cap', v_raw, 'daily_cap', v_cap, 'points_today', v_done + v_award,
    'co2_saved_g', round(v_dist / 1000.0 * private.config_num('eco.co2_g_per_km', 120)));
end;
$$;

create or replace function public.start_bike_ride(p_bike_code text, p_latitude double precision, p_longitude double precision)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_bike_code, '')));
  b public.bike_rides;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if private.is_banned(v_uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  if v_code !~ '^[A-Z0-9-]{2,20}$' then
    raise exception 'invalid_bike_code' using errcode = 'P0001';
  end if;
  select * into b from public.bike_rides r where r.user_id = v_uid and r.status = 'active';
  if found then
    return jsonb_build_object('status', 'already_active', 'ride_id', b.id, 'started_at', b.started_at, 'bike_code', b.bike_code);
  end if;
  insert into public.bike_rides (user_id, bike_code, start_lat, start_lng)
  values (v_uid, v_code, p_latitude, p_longitude) returning * into b;
  return jsonb_build_object('status', 'started', 'ride_id', b.id, 'started_at', b.started_at, 'bike_code', b.bike_code);
end;
$$;

create or replace function public.finish_bike_ride(
  p_ride_id uuid, p_latitude double precision, p_longitude double precision, p_distance_m integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  update public.bike_rides r set end_lat = p_latitude, end_lng = p_longitude, ended_at = now()
  where r.id = p_ride_id and r.user_id = v_uid and r.status = 'active';
  if not found then
    raise exception 'ride_not_active' using errcode = 'P0001';
  end if;
  return private.complete_bike_ride(p_ride_id, p_distance_m);
end;
$$;

create or replace function public.cancel_bike_ride(p_ride_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.bike_rides r set status = 'cancelled', ended_at = now()
  where r.id = p_ride_id and r.user_id = (select auth.uid()) and r.status = 'active';
end;
$$;

-- For the municipality's bike-rental system (server to server, secret key only — not granted to the app).
create or replace function public.record_municipal_bike_ride(
  p_user_id uuid, p_bike_code text, p_started_at timestamptz, p_ended_at timestamptz, p_distance_m integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_ended_at <= p_started_at or p_ended_at > now() + interval '5 minutes' then
    raise exception 'invalid_ride_times' using errcode = 'P0001';
  end if;
  insert into public.bike_rides (user_id, bike_code, source, started_at, ended_at, status)
  values (p_user_id, upper(btrim(p_bike_code)), 'municipal_system', p_started_at, p_ended_at, 'completed')
  returning id into v_id;
  return private.complete_bike_ride(v_id, p_distance_m);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Camera capture metadata (GPS + server time for every uploaded photo)
-- ---------------------------------------------------------------------------
create table if not exists public.photo_captures (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid references public.profiles (id) on delete set null,
  bucket text not null check (bucket in ('report-photos', 'cleanup-photos')),
  path text not null check (char_length(path) between 5 and 300),
  source text not null default 'camera' check (source = 'camera'),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  accuracy_m numeric(8, 1) check (accuracy_m is null or accuracy_m >= 0),
  device_captured_at timestamptz,
  server_recorded_at timestamptz not null default now(),
  unique (bucket, path)
);
alter table public.photo_captures enable row level security;

create or replace function public.record_photo_capture(
  p_bucket text, p_path text, p_latitude double precision, p_longitude double precision,
  p_accuracy_m numeric, p_device_captured_at timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.photo_captures;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_bucket not in ('report-photos', 'cleanup-photos') or p_path is null
     or split_part(p_path, '/', 1) <> v_uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path) then
    raise exception 'invalid_photo' using errcode = 'P0001';
  end if;
  insert into public.photo_captures (uploader_id, bucket, path, latitude, longitude, accuracy_m, device_captured_at)
  values (v_uid, p_bucket, p_path, p_latitude, p_longitude, round(p_accuracy_m, 1), p_device_captured_at)
  on conflict (bucket, path) do nothing
  returning * into v_row;
  return jsonb_build_object('status', 'ok', 'server_recorded_at', coalesce(v_row.server_recorded_at, now()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke execute on function public.muni_create_mystery_drop(text, text, double precision, double precision, integer, text, numeric, integer) from public, anon;
revoke execute on function public.muni_end_mystery_drop(uuid) from public, anon;
revoke execute on function public.sync_walk_steps(integer) from public, anon;
revoke execute on function public.start_bike_ride(text, double precision, double precision) from public, anon;
revoke execute on function public.finish_bike_ride(uuid, double precision, double precision, integer) from public, anon;
revoke execute on function public.cancel_bike_ride(uuid) from public, anon;
revoke execute on function public.record_municipal_bike_ride(uuid, text, timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.record_photo_capture(text, text, double precision, double precision, numeric, timestamptz) from public, anon;

grant execute on function public.muni_create_mystery_drop(text, text, double precision, double precision, integer, text, numeric, integer) to authenticated, service_role;
grant execute on function public.muni_end_mystery_drop(uuid) to authenticated, service_role;
grant execute on function public.sync_walk_steps(integer) to authenticated, service_role;
grant execute on function public.start_bike_ride(text, double precision, double precision) to authenticated, service_role;
grant execute on function public.finish_bike_ride(uuid, double precision, double precision, integer) to authenticated, service_role;
grant execute on function public.cancel_bike_ride(uuid) to authenticated, service_role;
grant execute on function public.record_municipal_bike_ride(uuid, text, timestamptz, timestamptz, integer) to service_role;
grant execute on function public.record_photo_capture(text, text, double precision, double precision, numeric, timestamptz) to authenticated, service_role;

grant all on public.mystery_drops, public.eco_mobility_logs, public.bike_rides, public.photo_captures to service_role;

grant select on public.mystery_drops to anon, authenticated;
create policy "Recent drops are public, admins see all"
  on public.mystery_drops for select to anon, authenticated
  using (coalesce(ended_early_at, ends_at) > now() - interval '7 days' or (select private.is_points_admin()));

grant select on public.eco_mobility_logs to authenticated;
create policy "Own mobility logs, admins see all"
  on public.eco_mobility_logs for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_points_admin()));

grant select on public.bike_rides to authenticated;
create policy "Own bike rides, admins see all"
  on public.bike_rides for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_points_admin()));

grant select on public.photo_captures to authenticated;
create policy "Uploader and staff see capture metadata"
  on public.photo_captures for select to authenticated
  using (uploader_id = (select auth.uid()) or (select private.is_staff()));

do $$
declare
  t text;
begin
  foreach t in array array['mystery_drops', 'bike_rides', 'eco_mobility_logs'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
