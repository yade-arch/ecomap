-- EcoMap 6b: EARTHCARE points management
--   * municipality admins (municipal_users.role = 'manager', or platform admins) can add, deduct
--     or set any citizen's EcoPuan; every change is written to an append-only audit log;
--   * citizens can only read their own balance and history, and spend EcoPuan on rewards;
--   * the ledger (points_transactions) stays the single source of truth: "set to N" is stored
--     as the difference, and the existing trigger keeps profiles.total_points in step;
--   * profiles, ledger, audit log and redemptions are published to Realtime, so both the admin
--     and the citizen screens update without a reload (RLS decides who receives which row).
-- Authorisation is enforced here, not in the app: a refused call raises SQLSTATE 42501, which
-- PostgREST returns to a signed-in caller as HTTP 403 Forbidden.

-- ---------------------------------------------------------------------------
-- Who is a municipality admin
-- ---------------------------------------------------------------------------
create or replace function private.is_points_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin() or exists (
    select 1 from public.municipal_users mu
    where mu.user_id = (select auth.uid()) and mu.role = 'manager');
$$;
grant execute on function private.is_points_admin() to anon, authenticated;

-- The app asks once what the user may do; the new flag drives the admin UI (the database still decides).
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
    'is_municipality_admin', private.is_points_admin(),
    'municipality_ids', coalesce((select jsonb_agg(m) from private.my_municipality_ids() m), '[]'::jsonb),
    'is_banned', private.is_banned((select auth.uid()))
  );
$$;
grant execute on function public.get_my_access() to authenticated;

-- ---------------------------------------------------------------------------
-- Notification types used below
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'report_approved', 'report_rejected', 'report_cleaned', 'cleanup_joined', 'cleanup_submitted',
  'cleanup_approved', 'cleanup_rejected', 'points_awarded', 'system', 'report_status', 'report_supported',
  'report_assigned', 'points_adjusted', 'reward_redeemed'));

-- ---------------------------------------------------------------------------
-- Audit log: one row per change made by a municipality admin
-- ---------------------------------------------------------------------------
create table if not exists public.points_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  transaction_id uuid references public.points_transactions (id) on delete set null,
  operation text not null check (operation in ('add', 'subtract', 'set')),
  previous_points integer not null,
  delta integer not null,
  new_points integer not null check (new_points >= 0),
  reason text not null check (char_length(btrim(reason)) between 3 and 200),
  created_at timestamptz not null default now(),
  constraint points_audit_log_math check (new_points = previous_points + delta)
);
create index if not exists points_audit_log_target_idx on public.points_audit_log (target_user_id, created_at desc);
create index if not exists points_audit_log_actor_idx on public.points_audit_log (actor_id, created_at desc);
create index if not exists points_audit_log_created_idx on public.points_audit_log (created_at desc);
alter table public.points_audit_log enable row level security;

-- Append-only, also for the service role. The only change allowed is a deleted account's id
-- becoming null (the foreign keys above), so the record itself survives account deletion.
create or replace function private.points_audit_log_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_log_is_append_only' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.transaction_id is distinct from old.transaction_id and new.transaction_id is not null
     or new.operation is distinct from old.operation
     or new.previous_points is distinct from old.previous_points
     or new.delta is distinct from old.delta
     or new.new_points is distinct from old.new_points
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at
     or (new.actor_id is distinct from old.actor_id and new.actor_id is not null)
     or (new.target_user_id is distinct from old.target_user_id and new.target_user_id is not null) then
    raise exception 'audit_log_is_append_only' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists points_audit_log_guard on public.points_audit_log;
create trigger points_audit_log_guard
  before update or delete on public.points_audit_log
  for each row execute function private.points_audit_log_guard();

-- ---------------------------------------------------------------------------
-- Rewards catalogue and redemptions
-- ---------------------------------------------------------------------------
create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z_]{2,40}$'),
  title text not null check (char_length(btrim(title)) between 2 and 60),
  subtitle text not null check (char_length(subtitle) between 2 and 80),
  description text not null check (char_length(description) between 2 and 200),
  partner text not null check (char_length(partner) between 2 and 80),
  cost integer not null check (cost > 0 and cost <= 100000),
  icon text not null check (icon ~ '^[a-z_]{2,30}$'),
  accent text not null check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  valid_minutes integer not null default 1440 check (valid_minutes between 5 and 43200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.rewards enable row level security;

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  reward_id uuid not null references public.rewards (id) on delete restrict,
  code text not null unique check (code ~ '^EC-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  points_spent integer not null check (points_spent > 0),
  transaction_id uuid references public.points_transactions (id) on delete set null,
  status text not null default 'issued' check (status in ('issued', 'used', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists reward_redemptions_user_idx on public.reward_redemptions (user_id, created_at desc);
alter table public.reward_redemptions enable row level security;

-- ---------------------------------------------------------------------------
-- Admin RPC: change a citizen's EcoPuan
--   p_operation: 'add' | 'subtract' | 'set'
--   p_amount:    add/subtract > 0, set >= 0
-- ---------------------------------------------------------------------------
create or replace function public.muni_adjust_points(
  p_user_id uuid, p_operation text, p_amount integer, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := private.clean_text(p_reason, 200);
  v_prev integer;
  v_delta integer;
  v_new integer;
  v_tx uuid;
  v_log bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.is_points_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_adjust_own_points' using errcode = '42501';
  end if;
  if p_operation is null or p_operation not in ('add', 'subtract', 'set') then
    raise exception 'invalid_operation' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 100000
     or (p_operation in ('add', 'subtract') and p_amount = 0) then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  -- Lock the row: two admins changing the same citizen at once are applied one after the other.
  select p.total_points into v_prev from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  v_delta := case p_operation
    when 'add' then p_amount
    when 'subtract' then -p_amount
    else p_amount - v_prev end;
  v_new := v_prev + v_delta;
  if v_new < 0 then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  if v_delta <> 0 then
    insert into public.points_transactions (user_id, transaction_type, points, reason)
    values (p_user_id,
            case when p_operation = 'set' then 'municipal_set' else 'municipal_adjustment' end::public.points_transaction_type,
            v_delta, v_reason)
    returning id into v_tx;  -- the ledger trigger updates profiles.total_points
  end if;

  insert into public.points_audit_log
    (actor_id, target_user_id, transaction_id, operation, previous_points, delta, new_points, reason)
  values (v_uid, p_user_id, v_tx, p_operation, v_prev, v_delta, v_new, v_reason)
  returning id into v_log;

  if v_delta <> 0 then
    perform private.notify(p_user_id, 'points_adjusted', null,
      jsonb_build_object('delta', v_delta, 'new_points', v_new, 'reason', v_reason));
  end if;

  return jsonb_build_object(
    'status', 'ok', 'audit_id', v_log, 'transaction_id', v_tx,
    'previous_points', v_prev, 'delta', v_delta, 'new_points', v_new);
end;
$$;

-- Admin RPC: citizens with their balance, searchable by name or city.
create or replace function public.muni_list_citizens(
  p_search text default null, p_limit integer default 100, p_offset integer default 0)
returns table (
  id uuid, display_name text, avatar_url text, city text, total_points integer,
  reports_count integer, cleans_count integer, last_change_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.is_points_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.display_name, p.avatar_url, p.city, p.total_points, p.reports_count, p.cleans_count,
           (select max(pt.created_at) from public.points_transactions pt where pt.user_id = p.id),
           p.created_at
    from public.profiles p
    where not exists (select 1 from public.staff_roles sr where sr.user_id = p.id)
      and not exists (select 1 from public.municipal_users mu where mu.user_id = p.id)
      and (v_search is null
           or p.display_name ilike '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%'
           or coalesce(p.city, '') ilike '%' || replace(replace(v_search, '%', '\%'), '_', '\_') || '%')
    order by p.total_points desc, p.display_name
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Citizen RPCs
-- ---------------------------------------------------------------------------
-- Numbers for the home screen: balance, rank, approved contributions, estimated waste, rewards used.
-- Waste is an ESTIMATE (kg per verified cleanup by severity, from app_config), not a weighed amount.
create or replace function public.get_my_earthcare_summary()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'total_points', p.total_points,
    'rank', public.get_my_rank(),
    'contributions', p.reports_count + p.cleans_count,
    'waste_kg', coalesce((
      select round(sum(private.config_num('earthcare.kg_per_cleanup.' || r.severity::text,
               case r.severity when 'low' then 2 when 'medium' then 5 else 10 end)), 1)
      from public.points_transactions pt
      join public.pollution_reports r on r.id = pt.report_id
      where pt.user_id = p.id and pt.transaction_type = 'cleanup_reward'
        and not exists (select 1 from public.points_transactions x
                        where x.related_transaction_id = pt.id and x.transaction_type = 'reversal')), 0),
    'rewards_used', (select count(*) from public.reward_redemptions rr
                     where rr.user_id = p.id and rr.status in ('issued', 'used'))
  )
  from public.profiles p
  where p.id = (select auth.uid());
$$;

-- Spend EcoPuan on a reward; returns the single-use code shown as a QR code.
create or replace function public.redeem_reward(p_reward_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reward public.rewards;
  v_balance integer;
  v_code text;
  v_tx uuid;
  v_id uuid;
  v_expires timestamptz;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if private.is_banned(v_uid) then
    raise exception 'banned' using errcode = '42501';
  end if;
  select * into v_reward from public.rewards r where r.id = p_reward_id and r.active;
  if not found then
    raise exception 'reward_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.reward_redemptions rr
      where rr.user_id = v_uid and rr.created_at > now() - interval '24 hours')
     >= private.config_num('limits.redemptions_per_day', 10) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select p.total_points into v_balance from public.profiles p where p.id = v_uid for update;
  if v_balance < v_reward.cost then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  loop
    v_code := 'EC-' || (
      select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      from generate_series(1, 4)) || '-' || (
      select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
      from generate_series(1, 4));
    exit when not exists (select 1 from public.reward_redemptions rr where rr.code = v_code);
  end loop;

  insert into public.points_transactions (user_id, transaction_type, points, reason)
  values (v_uid, 'reward_redeem', -v_reward.cost, left('reward:' || v_reward.slug, 200))
  returning id into v_tx;

  v_expires := now() + make_interval(mins => v_reward.valid_minutes);
  insert into public.reward_redemptions (user_id, reward_id, code, points_spent, transaction_id, expires_at)
  values (v_uid, v_reward.id, v_code, v_reward.cost, v_tx, v_expires)
  returning id into v_id;

  perform private.notify(v_uid, 'reward_redeemed', null,
    jsonb_build_object('reward', v_reward.slug, 'code', v_code, 'points', v_reward.cost));

  return jsonb_build_object(
    'status', 'ok', 'redemption_id', v_id, 'code', v_code, 'points_spent', v_reward.cost,
    'remaining', v_balance - v_reward.cost, 'expires_at', v_expires);
end;
$$;

-- Partner desk / municipality admin marks a code as used (a code works once).
create or replace function public.muni_use_redemption(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.reward_redemptions;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.is_points_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_row from public.reward_redemptions rr where rr.code = upper(btrim(p_code)) for update;
  if not found then
    raise exception 'code_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'issued' and v_row.expires_at < now() then
    update public.reward_redemptions rr set status = 'expired' where rr.id = v_row.id;
    return jsonb_build_object('status', 'expired');
  end if;
  if v_row.status <> 'issued' then
    return jsonb_build_object('status', v_row.status);
  end if;
  update public.reward_redemptions rr set status = 'used', used_at = now(), used_by = v_uid
  where rr.id = v_row.id;
  return jsonb_build_object('status', 'used');
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: grants + RLS
-- ---------------------------------------------------------------------------
revoke execute on function public.muni_adjust_points(uuid, text, integer, text) from public, anon;
revoke execute on function public.muni_list_citizens(text, integer, integer) from public, anon;
revoke execute on function public.get_my_earthcare_summary() from public, anon;
revoke execute on function public.redeem_reward(uuid) from public, anon;
revoke execute on function public.muni_use_redemption(text) from public, anon;
grant execute on function public.muni_adjust_points(uuid, text, integer, text) to authenticated, service_role;
grant execute on function public.muni_list_citizens(text, integer, integer) to authenticated, service_role;
grant execute on function public.get_my_earthcare_summary() to authenticated, service_role;
grant execute on function public.redeem_reward(uuid) to authenticated, service_role;
grant execute on function public.muni_use_redemption(text) to authenticated, service_role;

grant all on public.points_audit_log, public.rewards, public.reward_redemptions to service_role;

-- Ledger: own rows, plus everything for municipality admins. Still no write access from the app.
drop policy if exists "Users see their own points history, admins see all" on public.points_transactions;
create policy "Users see their own points history, admins see all"
  on public.points_transactions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_points_admin()));

grant select on public.points_audit_log to authenticated;
create policy "Citizens see changes to their own points, admins see all"
  on public.points_audit_log for select to authenticated
  using (target_user_id = (select auth.uid()) or (select private.is_points_admin()));
-- no insert/update/delete policy: rows are written only by muni_adjust_points()

grant select on public.rewards to anon, authenticated;
create policy "Active rewards are public, admins also see inactive ones"
  on public.rewards for select to anon, authenticated
  using (active or (select private.is_points_admin()));

grant select on public.reward_redemptions to authenticated;
create policy "Users see their own redemptions, admins see all"
  on public.reward_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_points_admin()));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['profiles', 'points_transactions', 'points_audit_log', 'reward_redemptions'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Configuration and catalogue
-- ---------------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('earthcare.kg_per_cleanup.low', '2', 'Estimated kg of waste for a verified low-severity cleanup (home screen statistic)'),
  ('earthcare.kg_per_cleanup.medium', '5', 'Estimated kg of waste for a verified medium-severity cleanup'),
  ('earthcare.kg_per_cleanup.high', '10', 'Estimated kg of waste for a verified high-severity cleanup'),
  ('limits.redemptions_per_day', '10', 'Maximum reward codes one user can create in 24 hours')
on conflict (key) do nothing;

insert into public.rewards (slug, title, subtitle, description, partner, cost, icon, accent, sort_order, valid_minutes) values
  ('bike_rental', 'Bisiklet Kiralama', 'Ücretsiz 1 saat',
   'Belirli sürelerde ücretsiz veya indirimli bisiklet kiralama hakkı.', 'Marmaris Belediyesi', 200, 'bicycle', '#2E7D32', 1, 1440),
  ('halk_cafe', 'Halk Cafe', '%20 indirim kuponu',
   'Belirli ürünlerde indirim kuponu veya ücretsiz içecek hakkı.', 'Halk Cafe', 100, 'cafe', '#E8711A', 2, 1440),
  ('parking', 'Otopark', 'Ücretsiz kullanım süresi',
   'Belirli sürelerde ücretsiz veya indirimli otopark kullanım hakkı.', 'Marmaris Belediyesi', 100, 'car', '#1E6FD9', 3, 1440),
  ('halk_ekmek', 'Halk Ekmek', 'Ekmek alma hakkı',
   'Belirlenen miktarda ücretsiz veya indirimli ekmek alma hakkı.', 'Halk Ekmek', 100, 'bread', '#A0642B', 4, 1440)
on conflict (slug) do nothing;
