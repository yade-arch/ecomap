-- EARTHCARE test data — LOCAL DEVELOPMENT ONLY (`supabase db reset` runs this after the migrations).
-- Do not run on a production project: it creates sign-in accounts with a known password.
--
-- Test accounts (password for all four: EarthCare-Test-2026):
--   yonetici@earthcare.test   Belediye Yöneticisi  -> municipal_users.role = 'manager' (municipality_admin)
--   ayse@earthcare.test       Vatandaş              -> starts with 1.250 EcoPuan
--   mehmet@earthcare.test     Vatandaş              -> starts with 450 EcoPuan
--   elif@earthcare.test       Vatandaş              -> starts with 120 EcoPuan

-- ---------------------------------------------------------------------------
-- Auth users (the on_auth_user_created trigger creates the profiles and roles)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('EarthCare-Test-2026', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', u.name, 'city', 'Marmaris', 'country', 'Türkiye',
                     'preferred_language', 'tr', 'roles', jsonb_build_array('observer', 'activist')),
  now(), now(), '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'yonetici@earthcare.test', 'Belediye Yöneticisi'),
  ('c0000000-0000-4000-8000-000000000001'::uuid, 'ayse@earthcare.test', 'Ayşe Demir'),
  ('c0000000-0000-4000-8000-000000000002'::uuid, 'mehmet@earthcare.test', 'Mehmet Kaya'),
  ('c0000000-0000-4000-8000-000000000003'::uuid, 'elif@earthcare.test', 'Elif Şahin')
) as u(id, email, name)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@earthcare.test'
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- ---------------------------------------------------------------------------
-- The admin: manager of the Marmaris pilot municipality
-- ---------------------------------------------------------------------------
insert into public.municipal_users (municipality_id, user_id, role)
select m.id, 'a0000000-0000-4000-8000-000000000001', 'manager'
from public.municipalities m
where m.code = 'MRM'
on conflict (municipality_id, user_id) do update set role = 'manager';

-- ---------------------------------------------------------------------------
-- Starting balances, made through the real RPC as the admin, so the audit log has history.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.muni_adjust_points('c0000000-0000-4000-8000-000000000001', 'add', 1000, 'Geri dönüşüm katkısı');
select public.muni_adjust_points('c0000000-0000-4000-8000-000000000001', 'add', 250, 'Etkinlik katılımı');
select public.muni_adjust_points('c0000000-0000-4000-8000-000000000002', 'set', 450, 'Pilot başlangıç bakiyesi');
select public.muni_adjust_points('c0000000-0000-4000-8000-000000000003', 'add', 150, 'Sahil temizliği etkinliği');
select public.muni_adjust_points('c0000000-0000-4000-8000-000000000003', 'subtract', 30, 'Mükerrer kayıt düzeltmesi');

select set_config('request.jwt.claims', '', true);
