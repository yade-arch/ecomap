// Usage: npm run test:db
// Runs every EcoMap migration + seed.sql on an in-memory Postgres (PGlite) with minimal
// Supabase stubs (auth, storage, roles, publication), then checks the EARTHCARE points rules.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = new PGlite({ extensions: { pgcrypto } });

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema extensions;
create extension pgcrypto schema extensions;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
create table auth.users (
  instance_id uuid, id uuid primary key, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz, updated_at timestamptz, confirmation_token text, email_change text,
  email_change_token_new text, recovery_token text);
create table auth.identities (id uuid primary key, user_id uuid references auth.users on delete cascade,
  provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create publication supabase_realtime;
`;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

async function as(uid, sql, params = []) {
  await db.exec('begin');
  try {
    if (uid === 'anon') {
      await db.exec(`set local role anon`);
    } else {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
      await db.exec(`set local role authenticated`);
    }
    const r = await db.query(sql, params);
    await db.exec('commit');
    return { rows: r.rows };
  } catch (e) {
    await db.exec('rollback');
    return { error: e };
  }
}

const ADMIN = 'a0000000-0000-4000-8000-000000000001';
const AYSE = 'c0000000-0000-4000-8000-000000000001';
const MEHMET = 'c0000000-0000-4000-8000-000000000002';
const ELIF = 'c0000000-0000-4000-8000-000000000003';

await db.exec(STUBS);
const migDir = path.join(root, 'supabase', 'migrations');
for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
  try {
    await db.exec('begin;\n' + fs.readFileSync(path.join(migDir, f), 'utf8') + '\ncommit;');
    console.log('migration ok:', f);
  } catch (e) {
    console.log('MIGRATION FAILED:', f, e.message);
    process.exit(1);
  }
}
try {
  await db.exec('begin;\n' + fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8') + '\ncommit;');
  console.log('seed ok');
} catch (e) {
  console.log('SEED FAILED:', e.message);
  process.exit(1);
}

const bal = async (id) => (await db.query('select total_points from public.profiles where id = $1', [id])).rows[0].total_points;

console.log('\n[seed]');
ok((await bal(AYSE)) === 1250, 'Ayşe 1250');
ok((await bal(MEHMET)) === 450, 'Mehmet 450');
ok((await bal(ELIF)) === 120, 'Elif 120');
ok((await db.query('select count(*)::int n from public.points_audit_log')).rows[0].n === 5, '5 audit rows from seed');

console.log('\n[access flags]');
let r = await as(ADMIN, 'select public.get_my_access() a');
ok(r.rows?.[0].a.is_municipality_admin === true, 'admin is_municipality_admin = true');
r = await as(AYSE, 'select public.get_my_access() a');
ok(r.rows?.[0].a.is_municipality_admin === false, 'citizen is_municipality_admin = false');

console.log('\n[citizen is refused -> 42501 = HTTP 403]');
r = await as(AYSE, `select public.muni_adjust_points($1, 'add', 999, 'hile denemesi')`, [AYSE]);
ok(r.error?.code === '42501', 'citizen adjusting own points: 42501 (' + r.error?.message + ')');
r = await as(AYSE, `select public.muni_adjust_points($1, 'add', 999, 'hile denemesi')`, [MEHMET]);
ok(r.error?.code === '42501', 'citizen adjusting other user: 42501');
r = await as(AYSE, `select * from public.muni_list_citizens()`);
ok(r.error?.code === '42501', 'citizen listing citizens: 42501');
r = await as(AYSE, `update public.profiles set total_points = 99999 where id = $1`, [AYSE]);
ok(r.error?.code === '42501', 'citizen direct UPDATE total_points: permission denied');
r = await as(AYSE, `insert into public.points_transactions (user_id, transaction_type, points) values ($1, 'municipal_adjustment', 500)`, [AYSE]);
ok(!!r.error, 'citizen direct INSERT ledger: denied');
r = await as(AYSE, `insert into public.points_audit_log (actor_id, target_user_id, operation, previous_points, delta, new_points, reason) values ($1,$1,'add',0,5,5,'xxx')`, [AYSE]);
ok(!!r.error, 'citizen direct INSERT audit: denied');
r = await as('anon', `select public.muni_adjust_points($1, 'add', 5, 'anon deneme')`, [AYSE]);
ok(!!r.error, 'anon cannot execute RPC');
ok((await bal(AYSE)) === 1250, 'balance unchanged after all refused attempts');

console.log('\n[citizen reads only own rows]');
r = await as(AYSE, 'select distinct target_user_id from public.points_audit_log');
ok(r.rows.length === 1 && r.rows[0].target_user_id === AYSE, 'audit log: only own rows');
r = await as(AYSE, 'select distinct user_id from public.points_transactions');
ok(r.rows.length === 1 && r.rows[0].user_id === AYSE, 'ledger: only own rows');
r = await as(ADMIN, 'select count(distinct target_user_id)::int n from public.points_audit_log');
ok(r.rows[0].n === 3, 'admin sees all audit rows');

console.log('\n[admin changes]');
r = await as(ADMIN, `select public.muni_adjust_points($1, 'add', 50, 'Geri dönüşüm katkısı') x`, [MEHMET]);
ok(r.rows?.[0].x.new_points === 500 && (await bal(MEHMET)) === 500, 'add 50 -> 500');
r = await as(ADMIN, `select public.muni_adjust_points($1, 'subtract', 20, 'Düzeltme') x`, [MEHMET]);
ok((await bal(MEHMET)) === 480, 'subtract 20 -> 480');
r = await as(ADMIN, `select public.muni_adjust_points($1, 'set', 300, 'Yeni değer atandı') x`, [MEHMET]);
ok(r.rows?.[0].x.delta === -180 && (await bal(MEHMET)) === 300, 'set 300 -> delta -180');
r = await as(ADMIN, `select public.muni_adjust_points($1, 'set', 300, 'Aynı değer') x`, [MEHMET]);
ok(r.rows?.[0].x.delta === 0 && r.rows?.[0].x.transaction_id === null, 'set same value: audit only, no ledger row');
r = await as(ADMIN, `select public.muni_adjust_points($1, 'subtract', 10000, 'Fazla düşüm')`, [MEHMET]);
ok(r.error?.message === 'insufficient_points', 'cannot go below zero');
r = await as(ADMIN, `select public.muni_adjust_points($1, 'add', 10, '')`, [MEHMET]);
ok(r.error?.message === 'reason_required', 'reason required');
r = await as(ADMIN, `select public.muni_adjust_points($1, 'add', 10, 'Kendime puan')`, [ADMIN]);
ok(r.error?.code === '42501', 'admin cannot change own points');
r = await as(ADMIN, `select * from public.points_audit_log where target_user_id = $1 order by id desc limit 1`, [MEHMET]);
const last = r.rows[0];
ok(last.actor_id === ADMIN && last.previous_points === 300 && last.delta === 0 && last.new_points === 300 && last.reason === 'Aynı değer' && last.created_at, 'audit row has actor, target, prev, delta, new, reason, timestamp');
r = await as(ADMIN, 'select * from public.muni_list_citizens()');
ok(r.rows?.length === 3 && !r.rows.some((x) => x.id === ADMIN), 'admin lists 3 citizens (not staff)');
r = await as(ADMIN, `select * from public.muni_list_citizens('ayş')`);
ok(r.rows?.length === 1, 'search by name');
r = await as(MEHMET, `select count(*)::int n from public.notifications where type = 'points_adjusted'`);
ok(r.rows[0].n >= 3, 'citizen got points_adjusted notifications');

console.log('\n[audit log is append-only]');
r = await as(ADMIN, 'update public.points_audit_log set delta = 0');
ok(!!r.error, 'admin cannot UPDATE audit');
try { await db.exec('update public.points_audit_log set reason = $$x$$'); ok(false, 'superuser UPDATE blocked'); }
catch (e) { ok(e.message === 'audit_log_is_append_only', 'even superuser UPDATE blocked by trigger'); }
try { await db.exec('delete from public.points_audit_log'); ok(false, 'superuser DELETE blocked'); }
catch (e) { ok(e.message === 'audit_log_is_append_only', 'even superuser DELETE blocked by trigger'); }

console.log('\n[rewards]');
const cafe = (await db.query(`select id from public.rewards where slug = 'halk_cafe'`)).rows[0].id;
const bike = (await db.query(`select id from public.rewards where slug = 'bike_rental'`)).rows[0].id;
r = await as(ELIF, 'select public.redeem_reward($1) x', [cafe]);
ok(r.rows?.[0].x.remaining === 20 && /^EC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(r.rows[0].x.code), 'Elif redeems Halk Cafe: 120 -> 20, code ' + r.rows?.[0].x.code);
const code = r.rows?.[0].x.code;
r = await as(ELIF, 'select public.redeem_reward($1) x', [bike]);
ok(r.error?.message === 'insufficient_points', 'insufficient balance refused');
r = await as(ELIF, 'select public.get_my_earthcare_summary() s');
ok(r.rows?.[0].s.total_points === 20 && r.rows[0].s.rewards_used === 1, 'summary: balance 20, 1 reward used');
r = await as(AYSE, 'select count(*)::int n from public.reward_redemptions');
ok(r.rows[0].n === 0, 'Ayşe cannot see Elif redemption');
r = await as(ELIF, 'select public.muni_use_redemption($1) x', [code]);
ok(r.error?.code === '42501', 'citizen cannot mark code used');
r = await as(ADMIN, 'select public.muni_use_redemption($1) x', [code]);
ok(r.rows?.[0].x.status === 'used', 'admin marks code used');
r = await as(ADMIN, 'select public.muni_use_redemption($1) x', [code]);
ok(r.rows?.[0].x.status === 'used', 'second use reports already used');

console.log('\n[realtime publication]');
const pub = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`)).rows.map((x) => x.tablename);
ok(['profiles', 'points_transactions', 'points_audit_log', 'reward_redemptions'].every((t) => pub.includes(t)), 'published: ' + pub.join(', '));

console.log('\n[account deletion keeps the audit trail]');
r = await as(ELIF, 'select public.delete_my_account()');
ok(!r.error, 'citizen with audit history can delete account ' + (r.error?.message ?? ''));
ok((await db.query(`select count(*)::int n from public.points_audit_log where target_user_id is null`)).rows[0].n === 2, 'audit rows kept, target set to null');

// ---------------------------------------------------------------------------
// Gizli Hazine (mystery drops)
// ---------------------------------------------------------------------------
console.log('\n[mystery drops]');
const MARMARIS = { lat: 36.8510, lng: 28.2740 };
r = await as(AYSE, `select public.muni_create_mystery_drop('Sahil', null, $1, $2, 500, 'multiplier', 2, 6)`, [MARMARIS.lat, MARMARIS.lng]);
ok(r.error?.code === '42501', 'citizen cannot open a drop (403)');
r = await as(ADMIN, `select public.muni_create_mystery_drop('Sahil Temizliği', 'Kordon boyu', $1, $2, 500, 'multiplier', 2, 6) x`, [MARMARIS.lat, MARMARIS.lng]);
ok(r.rows?.[0].x.label === '2x', 'admin opens a 2x drop: ' + (r.error?.message ?? r.rows?.[0].x.label));
const dropId = r.rows?.[0].x.id;
r = await as(AYSE, `select count(*)::int n from public.notifications where type = 'mystery_drop'`);
ok(r.rows[0].n === 1, 'citizen in Marmaris got an in-app mystery_drop notification');
r = await as('anon', 'select count(*)::int n from public.mystery_drops');
ok(r.rows?.[0].n === 1, 'active drop is visible to everyone (map)');

async function makeReport(userId, lat, lng) {
  const res = await db.query(
    `insert into public.pollution_reports (reporter_id, photo_path, latitude, longitude, ai_analysis_status, user_severity)
     values ($1::uuid, $1::text || '/r.jpg', $2, $3, 'completed', 'medium') returning id`, [userId, lat, lng]);
  return res.rows[0].id;
}
const before = await bal(MEHMET);
const rep1 = await makeReport(MEHMET, MARMARIS.lat + 0.001, MARMARIS.lng); // ~110 m from centre
await db.query(`select private.award_points($1, 'report_reward', 20, $2, null, 'report_accepted')`, [MEHMET, rep1]);
ok((await bal(MEHMET)) === before + 40, 'report inside drop: 20 + 20 bonus (2x)');
r = await db.query(`select reason, mystery_drop_id from public.points_transactions where report_id = $1 and transaction_type = 'mystery_bonus'`, [rep1]);
ok(r.rows[0]?.reason.startsWith('Gizli Hazine 2x Bonusu') && r.rows[0].mystery_drop_id === dropId, 'ledger reason "Gizli Hazine 2x Bonusu…" linked to the drop');
const rep2 = await makeReport(MEHMET, MARMARIS.lat + 0.02, MARMARIS.lng); // ~2.2 km away
await db.query(`select private.award_points($1, 'report_reward', 20, $2, null, 'report_accepted')`, [MEHMET, rep2]);
ok((await bal(MEHMET)) === before + 60, 'report outside drop: no bonus');
await db.query(`select private.reverse_report_reward($1, 'test')`, [rep1]);
ok((await bal(MEHMET)) === before + 20, 'reversing a reward also reverses its drop bonus');
r = await as(AYSE, 'select public.muni_end_mystery_drop($1)', [dropId]);
ok(r.error?.code === '42501', 'citizen cannot end a drop');
r = await as(ADMIN, 'select public.muni_end_mystery_drop($1)', [dropId]);
ok(!r.error, 'admin ends the drop early');
const rep3 = await makeReport(MEHMET, MARMARIS.lat, MARMARIS.lng);
await db.query(`select private.award_points($1, 'report_reward', 20, $2, null, 'report_accepted')`, [MEHMET, rep3]);
ok((await bal(MEHMET)) === before + 40, 'after the drop ended: no bonus');
r = await as(ADMIN, `select public.muni_create_mystery_drop('Park', null, $1, $2, 300, 'bonus', 50, 12) x`, [MARMARIS.lat, MARMARIS.lng]);
ok(r.rows?.[0].x.label === '+50 EC', 'fixed bonus drop label +50 EC');
const rep4 = await makeReport(MEHMET, MARMARIS.lat, MARMARIS.lng);
await db.query(`select private.award_points($1, 'report_reward', 20, $2, null, 'report_accepted')`, [MEHMET, rep4]);
ok((await bal(MEHMET)) === before + 110, 'fixed bonus drop: 20 + 50');
r = await as(ADMIN, `select public.muni_create_mystery_drop('X', null, $1, $2, 300, 'multiplier', 9, 6)`, [MARMARIS.lat, MARMARIS.lng]);
ok(r.error?.message === 'invalid_reward', 'multiplier above 5x refused');

// ---------------------------------------------------------------------------
// Eko-Ulaşım: walking
// ---------------------------------------------------------------------------
console.log('\n[eco walking]');
const ayseStart = await bal(AYSE);
r = await as(AYSE, 'select public.sync_walk_steps(6200) x');
ok(r.rows?.[0].x.steps === 6200 && r.rows[0].x.points_today === 40, '6.200 steps -> 40 EC (2 x 20)');
ok((await bal(AYSE)) === ayseStart + 40, 'balance +40');
r = await as(AYSE, 'select public.sync_walk_steps(6200) x');
ok(r.rows?.[0].x.points_added === 0, 'same steps again: nothing added (idempotent)');
r = await as(AYSE, 'select public.sync_walk_steps(90000) x');
ok(r.rows?.[0].x.steps <= 6200 + 600, 'sudden +84k steps clamped by time (anti-abuse): ' + r.rows?.[0].x.steps);
await db.query(`update public.eco_mobility_logs set updated_at = now() - interval '10 hours' where user_id = $1 and kind = 'walk'`, [AYSE]);
r = await as(AYSE, 'select public.sync_walk_steps(40000) x');
ok(r.rows?.[0].x.points_today === 100, 'daily cap 100 EC reached');
ok((await bal(AYSE)) === ayseStart + 100, 'balance capped at +100 for the day');
r = await as(AYSE, `select count(*)::int n from public.points_transactions where user_id = $1 and transaction_type = 'eco_walk' and reason = 'Eko-Ulaşım: Yürüyüş'`, [AYSE]);
ok(r.rows[0].n >= 2, 'ledger shows "Eko-Ulaşım: Yürüyüş"');

// ---------------------------------------------------------------------------
// Eko-Ulaşım: bikes
// ---------------------------------------------------------------------------
console.log('\n[eco bikes]');
const mStart = await bal(MEHMET);
r = await as(MEHMET, `select public.start_bike_ride('mrm-042', $1, $2) x`, [MARMARIS.lat, MARMARIS.lng]);
const ride1 = r.rows?.[0].x.ride_id;
ok(r.rows?.[0].x.status === 'started' && r.rows[0].x.bike_code === 'MRM-042', 'ride started, bike code normalised');
r = await as(MEHMET, `select public.start_bike_ride('MRM-043', $1, $2) x`, [MARMARIS.lat, MARMARIS.lng]);
ok(r.rows?.[0].x.status === 'already_active', 'only one active ride per user');
await db.query(`update public.bike_rides set started_at = now() - interval '40 minutes' where id = $1`, [ride1]);
r = await as(MEHMET, `select public.finish_bike_ride($1, $2, $3, 9000) x`, [ride1, MARMARIS.lat + 0.05, MARMARIS.lng]);
ok(r.rows?.[0].x.points === 90, '40 min / 9 km ride -> 3 x 30 = 90 EC: ' + JSON.stringify(r.rows?.[0].x ?? r.error?.message));
r = await as(MEHMET, `select public.start_bike_ride('MRM-042', $1, $2) x`, [MARMARIS.lat, MARMARIS.lng]);
const ride2 = r.rows?.[0].x.ride_id;
await db.query(`update public.bike_rides set started_at = now() - interval '10 minutes' where id = $1`, [ride2]);
r = await as(MEHMET, `select public.finish_bike_ride($1, null, null, 80000) x`, [ride2]);
ok(r.rows?.[0].x.distance_m <= 5834, 'claimed 80 km in 10 min cut to max speed: ' + r.rows?.[0].x.distance_m + ' m');
ok(r.rows?.[0].x.points === 30, 'daily bike cap 120 EC: only 30 more given');
ok((await bal(MEHMET)) === mStart + 120, 'balance +120 (cap)');
r = await as(MEHMET, `select public.start_bike_ride('MRM-1', null, null) x`);
r = await as(MEHMET, `select public.finish_bike_ride($1, null, null, 100) x`, [r.rows[0].x.ride_id]);
ok(r.rows?.[0].x.status === 'too_short', 'ride under 1 minute does not count');
r = await as(MEHMET, `select public.record_municipal_bike_ride($1, 'MRM-9', now() - interval '1 hour', now(), 12000)`, [MEHMET]);
ok(!!r.error, 'municipal rental webhook RPC is not callable from the app');
r = await as(AYSE, `select count(*)::int n from public.bike_rides`);
ok(r.rows[0].n === 0, "citizen cannot see someone else's rides");

// ---------------------------------------------------------------------------
// Camera capture metadata
// ---------------------------------------------------------------------------
console.log('\n[photo capture metadata]');
await db.query(`insert into storage.objects (bucket_id, name, owner) values ('report-photos', $1::text || '/cap.jpg', $1::uuid)`, [AYSE]);
r = await as(AYSE, `select public.record_photo_capture('report-photos', $1 || '/cap.jpg', 36.85, 28.27, 6.5, now()) x`, [AYSE]);
ok(r.rows?.[0].x.status === 'ok', 'capture metadata recorded with GPS + server time');
r = await as(AYSE, `select public.record_photo_capture('report-photos', $1 || '/cap.jpg', 1, 1, 1, now()) x`, [MEHMET]);
ok(r.error?.message === 'invalid_photo', "cannot attach metadata to someone else's photo");
r = await as(MEHMET, 'select count(*)::int n from public.photo_captures');
ok(r.rows[0].n === 0, 'other citizens cannot read capture metadata');
r = await as(ADMIN, 'select latitude, server_recorded_at from public.photo_captures');
ok(r.rows?.length === 1 && r.rows[0].server_recorded_at, 'municipal staff see GPS + server timestamp');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
