-- ============================================================
-- GymTrack — full schema reconciliation (idempotent)
-- Run this once in the Supabase SQL Editor. Safe to re-run.
--
-- Brings a project up to the complete current schema from ANY state:
-- every table is `create table if not exists`, every incremental column is
-- `add column if not exists`, RLS is (re)enabled, and every policy is
-- `drop policy if exists` then recreated. Use this when migrations were only
-- partially applied (e.g. saved_foods never existed, or workout_sets.drops /
-- food_logs.updated_at were never added), which silently breaks cloud sync/
-- backup for the affected table (PostgREST rejects the whole upsert over one
-- missing column).
--
-- personal_records is intentionally omitted: nothing writes it (PR detection is
-- client-side) so its IndexedDB store stays empty and backupToCloud skips empty
-- tables — it never needs to exist remotely.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ─── profiles ────────────────────────────────────────────────
create table if not exists profiles (
  id                     uuid references auth.users(id) on delete cascade primary key,
  username               text,
  weight_unit            text default 'kg' check (weight_unit in ('kg','lbs')),
  distance_unit          text default 'km' check (distance_unit in ('km','mi')),
  water_goal_liters      numeric(4,2) default 2.5,
  water_reminder_enabled boolean default true,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);
-- Per-user Gemini API key (admin panel / global AI-scanner flag, see app_settings below).
alter table profiles add column if not exists gemini_api_key text;
alter table profiles enable row level security;
drop policy if exists "own profile select" on profiles;
drop policy if exists "own profile insert" on profiles;
drop policy if exists "own profile update" on profiles;
create policy "own profile select" on profiles for select using (auth.uid() = id);
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);

-- ─── daily_weight_logs ───────────────────────────────────────
create table if not exists daily_weight_logs (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  logged_date date not null,
  weight      numeric(6,2) not null,
  notes       text,
  created_at  timestamptz default now(),
  unique(user_id, logged_date)
);
alter table daily_weight_logs enable row level security;
drop policy if exists "own weight logs" on daily_weight_logs;
create policy "own weight logs" on daily_weight_logs for all using (auth.uid() = user_id);

-- ─── water_logs ──────────────────────────────────────────────
create table if not exists water_logs (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references auth.users(id) on delete cascade not null,
  logged_date   date not null,
  amount_liters numeric(4,2) not null default 0,
  updated_at    timestamptz default now(),
  unique(user_id, logged_date)
);
alter table water_logs enable row level security;
drop policy if exists "own water logs" on water_logs;
create policy "own water logs" on water_logs for all using (auth.uid() = user_id);

-- ─── progress_photos ─────────────────────────────────────────
create table if not exists progress_photos (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  photo_date   date not null,
  storage_path text not null,
  notes        text,
  created_at   timestamptz default now()
);
alter table progress_photos enable row level security;
drop policy if exists "own progress photos" on progress_photos;
create policy "own progress photos" on progress_photos for all using (auth.uid() = user_id);

-- ─── exercises ───────────────────────────────────────────────
create table if not exists exercises (
  id                 uuid default uuid_generate_v4() primary key,
  user_id            uuid references auth.users(id) on delete cascade not null,
  name               text not null,
  muscle_group       text,
  machine_photo_path text,
  notes              text,
  created_at         timestamptz default now()
);
alter table exercises enable row level security;
drop policy if exists "own exercises" on exercises;
create policy "own exercises" on exercises for all using (auth.uid() = user_id);

-- ─── workout_folders ─────────────────────────────────────────
create table if not exists workout_folders (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references auth.users(id) on delete cascade not null,
  name             text not null,
  parent_folder_id uuid references workout_folders(id) on delete cascade,
  created_at       timestamptz default now()
);
alter table workout_folders enable row level security;
drop policy if exists "own folders select" on workout_folders;
drop policy if exists "own folders insert" on workout_folders;
drop policy if exists "own folders update" on workout_folders;
drop policy if exists "own folders delete" on workout_folders;
create policy "own folders select" on workout_folders for select using (auth.uid() = user_id);
create policy "own folders insert" on workout_folders for insert with check (auth.uid() = user_id);
create policy "own folders update" on workout_folders for update using (auth.uid() = user_id);
create policy "own folders delete" on workout_folders for delete using (auth.uid() = user_id);

-- ─── workout_sessions ────────────────────────────────────────
create table if not exists workout_sessions (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  session_date date not null default current_date,
  notes        text,
  folder_id    uuid references workout_folders(id) on delete set null,
  created_at   timestamptz default now()
);
alter table workout_sessions enable row level security;
drop policy if exists "own workout sessions" on workout_sessions;
create policy "own workout sessions" on workout_sessions for all using (auth.uid() = user_id);

-- ─── workout_sets ────────────────────────────────────────────
create table if not exists workout_sets (
  id            uuid default uuid_generate_v4() primary key,
  session_id    uuid references workout_sessions(id) on delete cascade not null,
  exercise_id   uuid references exercises(id) on delete set null,
  exercise_name text not null,
  set_number    integer not null,
  set_type      text not null default 'normal' check (set_type in ('normal','warmup','dropset')),
  reps          integer,
  weight        numeric(6,2),
  rpe           numeric(3,1),
  reps_2        integer,
  weight_2      numeric(6,2),
  reps_3        integer,
  weight_3      numeric(6,2),
  notes         text,
  created_at    timestamptz default now()
);
-- Incremental columns the app writes but that live outside the base schema:
alter table workout_sets add column if not exists weight_unit text default 'kg' check (weight_unit in ('kg','lbs'));
alter table workout_sets add column if not exists drops jsonb;
alter table workout_sets enable row level security;
drop policy if exists "own workout sets" on workout_sets;
create policy "own workout sets" on workout_sets for all using (
  session_id in (select id from workout_sessions where user_id = auth.uid())
);

-- ─── routine_exercises ───────────────────────────────────────
create table if not exists routine_exercises (
  id                uuid default uuid_generate_v4() primary key,
  folder_id         uuid references workout_folders(id) on delete cascade not null,
  exercise_id       uuid references exercises(id) on delete set null,
  exercise_name     text not null,
  order_index       integer not null default 0,
  planned_sets      integer not null default 3,
  planned_reps      integer not null default 10,
  planned_weight_kg numeric(6,2),
  rest_seconds      integer not null default 60,
  created_at        timestamptz default now()
);
alter table routine_exercises enable row level security;
drop policy if exists "own routine exercises" on routine_exercises;
create policy "own routine exercises" on routine_exercises for all using (
  folder_id in (select id from workout_folders where user_id = auth.uid())
);

-- ─── food_logs ───────────────────────────────────────────────
create table if not exists food_logs (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  logged_date date not null default current_date,
  meal_type   text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  food_name   text not null,
  calories    numeric(6,1) not null default 0,
  protein_g   numeric(5,1) not null default 0,
  carbs_g     numeric(5,1) not null default 0,
  fats_g      numeric(5,1) not null default 0,
  weight_g    numeric(6,1) default null,
  created_at  timestamptz default now()
);
alter table food_logs add column if not exists updated_at timestamptz default now();
alter table food_logs add column if not exists detail jsonb;
alter table food_logs enable row level security;
drop policy if exists "own food logs" on food_logs;
create policy "own food logs" on food_logs for all using (auth.uid() = user_id);

-- ─── saved_foods ─────────────────────────────────────────────
create table if not exists saved_foods (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references auth.users(id) on delete cascade not null,
  name             text not null,
  calories_100g    numeric(6,1) not null default 0,
  protein_100g     numeric(5,1) not null default 0,
  carbs_100g       numeric(5,1) not null default 0,
  fats_100g        numeric(5,1) not null default 0,
  default_weight_g numeric(6,1) default 100,
  created_at       timestamptz default now()
);
alter table saved_foods add column if not exists detail jsonb;
alter table saved_foods enable row level security;
drop policy if exists "own saved foods" on saved_foods;
create policy "own saved foods" on saved_foods for all using (auth.uid() = user_id);

-- ─── app_settings (admin panel global config) ────────────────
-- Single-row global config, readable by anyone (no sensitive data in it),
-- writable only by the allowlisted admin account. The email check mirrors
-- DEV_EMAILS in lib/devMode.ts — update both if that list ever grows.
create table if not exists app_settings (
  id integer primary key default 1 check (id = 1),
  ai_scanner_global_enabled boolean not null default false,
  updated_at timestamptz default now()
);
insert into app_settings (id) values (1) on conflict (id) do nothing;
alter table app_settings enable row level security;
drop policy if exists "anyone can read app settings" on app_settings;
drop policy if exists "admin can update app settings" on app_settings;
create policy "anyone can read app settings" on app_settings for select using (true);
create policy "admin can update app settings" on app_settings for update
  using (auth.jwt() ->> 'email' = 'sonluisfernando@gmail.com')
  with check (auth.jwt() ->> 'email' = 'sonluisfernando@gmail.com');

-- ─── auto-create profile on signup ───────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
