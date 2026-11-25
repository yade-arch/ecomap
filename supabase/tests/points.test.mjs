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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
