-- EcoMap — 1/4: tables, constraints, indexes
-- Every table lives in `public` with Row Level Security enabled (policies are in the security migration).
-- Helper functions live in `private`, which is not exposed through the Data API.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('observer', 'activist');
create type public.staff_role as enum ('moderator', 'admin');
create type public.severity_level as enum ('low', 'medium', 'high');
create type public.pollution_category as enum (
  'household_waste', 'plastic', 'construction_debris', 'bulky_waste', 'organic',
  'e_waste', 'hazardous', 'water_pollution', 'burning', 'other'
);
create type public.report_status as enum (
  'pending_review',        -- AI was unsure: only the reporter and staff can see it
  'active',
  'cleanup_in_progress',
  'pending_verification',
  'cleaned',
  'rejected'
);
create type public.ai_analysis_status as enum (
  'completed',     -- AI classified the photo
  'unavailable',   -- AI could not be reached (quota, outage): the user's own severity is used for now
  'needs_review',  -- AI answered but was not confident enough
  'failed'
);
create type public.photo_kind as enum ('report', 'evidence', 'cleanup_after');
create type public.verification_status as enum (
  'pending', 'ai_approved', 'manual_review', 'moderator_approved', 'rejected'
);
create type public.points_transaction_type as enum (
  'report_reward', 'cleanup_reward', 'adjustment', 'reversal'
);

-- ---------------------------------------------------------------------------
-- Configuration (point values, thresholds, limits) — change values here, not in code
-- ---------------------------------------------------------------------------
create table public.app_config (
  key text primary key check (key ~ '^[a-z0-9_.]{2,80}$'),
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  country text check (country is null or char_length(country) between 2 and 60),
  city text check (city is null or char_length(city) between 1 and 80),
  preferred_language text not null default 'tr'
    check (preferred_language in ('tr', 'en', 'de', 'fr', 'es')),
  -- The three counters below are caches. points_transactions is the source of truth.
  total_points integer not null default 0,
  reports_count integer not null default 0 check (reports_count >= 0),
  cleans_count integer not null default 0 check (cleans_count >= 0),
  leaderboard_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_leaderboard_idx on public.profiles (total_points desc, created_at)
  where not leaderboard_hidden;
create index profiles_city_idx on public.profiles (country, city);

-- Ordinary roles: a user may hold both at once.
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Staff roles are separate so that no client-side action can ever grant them.
create table public.staff_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.staff_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.user_bans (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reason text check (reason is null or char_length(reason) <= 500),
  banned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------------------
-- Municipalities
-- ---------------------------------------------------------------------------
create table public.municipalities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  country text not null check (char_length(country) between 2 and 60),
  city text not null check (char_length(city) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (country, city, name)
);
create index municipalities_city_idx on public.municipalities (lower(city));

create table public.municipal_users (
  municipality_id uuid not null references public.municipalities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (municipality_id, user_id)
);
create index municipal_users_user_idx on public.municipal_users (user_id);

-- ---------------------------------------------------------------------------
-- Pollution reports
-- ---------------------------------------------------------------------------
create table public.pollution_reports (
  id uuid primary key default gen_random_uuid(),
  -- set null (not cascade): the report stays on the map if the account is deleted
  reporter_id uuid references public.profiles (id) on delete set null,
  photo_path text not null check (char_length(photo_path) between 5 and 300),
  cleaned_photo_path text check (cleaned_photo_path is null or char_length(cleaned_photo_path) between 5 and 300),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  address text check (address is null or char_length(address) <= 300),
  country text check (country is null or char_length(country) <= 60),
  city text check (city is null or char_length(city) <= 80),
  municipality_id uuid references public.municipalities (id) on delete set null,
  description text check (description is null or char_length(description) <= 500),
  user_severity public.severity_level,
  ai_category public.pollution_category,
  ai_severity public.severity_level,
  ai_confidence numeric(4, 3) check (ai_confidence is null or ai_confidence between 0 and 1),
  ai_analysis_status public.ai_analysis_status not null,
  ai_summary text check (ai_summary is null or char_length(ai_summary) <= 500),
  ai_model text check (ai_model is null or char_length(ai_model) <= 80),
  ai_analyzed_at timestamptz,
  -- What the map shows: the AI's severity when there is one, otherwise the reporter's.
  severity public.severity_level generated always as (coalesce(ai_severity, user_severity)) stored,
  is_hazardous boolean not null default false,
  report_status public.report_status not null default 'active',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cleaned_at timestamptz,
  constraint pollution_reports_severity_known check (ai_severity is not null or user_severity is not null),
  constraint pollution_reports_cleaned_consistent check ((report_status = 'cleaned') = (cleaned_at is not null)),
  constraint pollution_reports_not_null_island check (not (latitude = 0 and longitude = 0))
);
create index pollution_reports_status_idx on public.pollution_reports (report_status);
create index pollution_reports_location_idx on public.pollution_reports (latitude, longitude);
create index pollution_reports_created_idx on public.pollution_reports (created_at desc);
create index pollution_reports_severity_idx on public.pollution_reports (severity);
create index pollution_reports_reporter_idx on public.pollution_reports (reporter_id, created_at desc);
create index pollution_reports_municipality_idx on public.pollution_reports (municipality_id);
create index pollution_reports_reanalysis_idx on public.pollution_reports (created_at)
  where ai_analysis_status = 'unavailable';

-- Every photo ever attached to a report. Rows are never deleted by users.
create table public.pollution_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.pollution_reports (id) on delete restrict,
  uploader_id uuid references public.profiles (id) on delete set null,
  kind public.photo_kind not null,
  bucket text not null check (bucket in ('report-photos', 'cleanup-photos')),
  path text not null check (char_length(path) between 5 and 300),
  bytes integer check (bytes is null or bytes > 0),
  mime_type text check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  created_at timestamptz not null default now(),
  unique (bucket, path)
);
create index pollution_photos_report_idx on public.pollution_photos (report_id, created_at);
create index pollution_photos_uploader_idx on public.pollution_photos (uploader_id);

create table public.report_status_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.pollution_reports (id) on delete restrict,
  old_status public.report_status,
  new_status public.report_status not null,
  changed_by uuid references public.profiles (id) on delete set null,
  reason text check (reason is null or char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index report_status_history_report_idx on public.report_status_history (report_id, created_at);

-- ---------------------------------------------------------------------------
-- Cleanups
-- ---------------------------------------------------------------------------
create table public.cleanup_participants (
  report_id uuid not null references public.pollution_reports (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (report_id, user_id)   -- one row per person per cleanup
);
create index cleanup_participants_user_idx on public.cleanup_participants (user_id);

create table public.cleanup_submissions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.pollution_reports (id) on delete restrict,
  activist_id uuid references public.profiles (id) on delete set null,
  before_photo_id uuid references public.pollution_photos (id) on delete restrict,
  after_photo_id uuid not null references public.pollution_photos (id) on delete restrict,
  distance_m integer check (distance_m is null or distance_m >= 0),
  ai_verification_result jsonb,
  ai_confidence numeric(4, 3) check (ai_confidence is null or ai_confidence between 0 and 1),
  verification_status public.verification_status not null default 'pending',
  moderator_id uuid references public.profiles (id) on delete set null,
  moderator_note text check (moderator_note is null or char_length(moderator_note) <= 500),
  submitted_at timestamptz not null default now(),
  verified_at timestamptz
);
create index cleanup_submissions_report_idx on public.cleanup_submissions (report_id, submitted_at desc);
create index cleanup_submissions_activist_idx on public.cleanup_submissions (activist_id);
create index cleanup_submissions_queue_idx on public.cleanup_submissions (submitted_at)
  where verification_status in ('pending', 'manual_review');
-- Only one cleanup can be waiting for a decision per report.
create unique index cleanup_submissions_one_open_idx on public.cleanup_submissions (report_id)
  where verification_status in ('pending', 'manual_review');
-- A report can be approved as cleaned only once.
create unique index cleanup_submissions_one_approved_idx on public.cleanup_submissions (report_id)
  where verification_status in ('ai_approved', 'moderator_approved');

-- ---------------------------------------------------------------------------
-- Points: an append-only ledger
-- ---------------------------------------------------------------------------
create table public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  report_id uuid references public.pollution_reports (id) on delete set null,
  cleanup_submission_id uuid references public.cleanup_submissions (id) on delete set null,
  transaction_type public.points_transaction_type not null,
  points integer not null check (points <> 0),
  reason text check (reason is null or char_length(reason) <= 200),
  related_transaction_id uuid references public.points_transactions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index points_transactions_user_idx on public.points_transactions (user_id, created_at desc);
create index points_transactions_report_idx on public.points_transactions (report_id);
-- Duplicate protection: at most one reward per person per qualifying action.
create unique index points_one_report_reward_idx on public.points_transactions (user_id, report_id)
  where transaction_type = 'report_reward';
create unique index points_one_cleanup_reward_idx on public.points_transactions (user_id, report_id)
  where transaction_type = 'cleanup_reward';
create unique index points_one_reversal_idx on public.points_transactions (related_transaction_id)
  where transaction_type = 'reversal';

-- ---------------------------------------------------------------------------
-- Chat: one room per report
-- ---------------------------------------------------------------------------
create table public.report_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.pollution_reports (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.report_chat_rooms (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null
);
create index chat_messages_room_idx on public.chat_messages (room_id, created_at);
create index chat_messages_sender_idx on public.chat_messages (sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Notifications, moderation
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in (
    'report_approved', 'report_rejected', 'report_cleaned', 'cleanup_joined',
    'cleanup_submitted', 'cleanup_approved', 'cleanup_rejected', 'points_awarded', 'system'
  )),
  report_id uuid references public.pollution_reports (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.moderation_logs (
  id bigint generated always as identity primary key,
  moderator_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) between 2 and 60),
  target_type text not null check (target_type in ('report', 'cleanup_submission', 'chat_message', 'user')),
  target_id uuid not null,
  note text check (note is null or char_length(note) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index moderation_logs_target_idx on public.moderation_logs (target_type, target_id);
create index moderation_logs_created_idx on public.moderation_logs (created_at desc);

-- Users flagging content for moderators (required for app-store review later).
create table public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('report', 'chat_message', 'user')),
  target_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index content_reports_open_idx on public.content_reports (created_at) where status = 'open';

-- ---------------------------------------------------------------------------
-- Row Level Security is switched on for everything, with no access until policies are added.
-- ---------------------------------------------------------------------------
alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.staff_roles enable row level security;
alter table public.user_bans enable row level security;
alter table public.user_blocks enable row level security;
alter table public.municipalities enable row level security;
alter table public.municipal_users enable row level security;
alter table public.pollution_reports enable row level security;
alter table public.pollution_photos enable row level security;
alter table public.report_status_history enable row level security;
alter table public.cleanup_participants enable row level security;
alter table public.cleanup_submissions enable row level security;
alter table public.points_transactions enable row level security;
alter table public.report_chat_rooms enable row level security;
alter table public.chat_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.moderation_logs enable row level security;
alter table public.content_reports enable row level security;
