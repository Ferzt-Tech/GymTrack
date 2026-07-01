-- ============================================================
-- GymTrack DB Schema — Supabase / PostgreSQL
-- Run this in the Supabase SQL Editor
-- ============================================================

create extension if not exists "uuid-ossp";

-- ─── Profiles ────────────────────────────────────────────────
create table profiles (
  id              uuid references auth.users(id) on delete cascade primary key,
  username        text,
  weight_unit     text default 'kg'  check (weight_unit  in ('kg',  'lbs')),
  distance_unit   text default 'km'  check (distance_unit in ('km', 'mi')),
  water_goal_liters numeric(4,2) default 2.5,
  water_reminder_enabled boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ─── Daily Weight Logs ───────────────────────────────────────
create table daily_weight_logs (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  logged_date date not null,
  weight      numeric(6,2) not null,
  notes       text,
  created_at  timestamptz default now(),
  unique(user_id, logged_date)
);

-- ─── Water Intake Logs ───────────────────────────────────────
create table water_logs (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  logged_date  date not null,
  amount_liters numeric(4,2) not null default 0,
  updated_at   timestamptz default now(),
  unique(user_id, logged_date)
);

-- ─── Progress Photos ─────────────────────────────────────────
create table progress_photos (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  photo_date   date not null,
  storage_path text not null,
  notes        text,
  created_at   timestamptz default now()
);

-- ─── Exercise Database ───────────────────────────────────────
create table exercises (
  id                uuid default uuid_generate_v4() primary key,
  user_id           uuid references auth.users(id) on delete cascade not null,
  name              text not null,
  muscle_group      text,
  machine_photo_path text,
  notes             text,
  created_at        timestamptz default now()
);

-- ─── Workout Folders ─────────────────────────────────────────
create table workout_folders (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references auth.users(id) on delete cascade not null,
  name             text not null,
  parent_folder_id uuid references workout_folders(id) on delete cascade,
  created_at       timestamptz default now()
);

-- ─── Workout Sessions ────────────────────────────────────────
create table workout_sessions (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references auth.users(id) on delete cascade not null,
  session_date date not null default current_date,
  notes        text,
  folder_id    uuid references workout_folders(id) on delete set null,
  created_at   timestamptz default now()
);

-- ─── Workout Sets ────────────────────────────────────────────
create table workout_sets (
  id            uuid default uuid_generate_v4() primary key,
  session_id    uuid references workout_sessions(id) on delete cascade not null,
  exercise_id   uuid references exercises(id) on delete set null,
  exercise_name text not null,
  set_number    integer not null,
  set_type      text not null default 'normal' check (set_type in ('normal', 'warmup', 'dropset')),
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

-- ─── Row-Level Security ──────────────────────────────────────
alter table profiles         enable row level security;
alter table daily_weight_logs enable row level security;
alter table water_logs       enable row level security;
alter table progress_photos  enable row level security;
alter table exercises        enable row level security;
alter table workout_folders   enable row level security;
alter table workout_sessions enable row level security;
alter table workout_sets     enable row level security;

-- profiles
create policy "own profile select" on profiles for select using (auth.uid() = id);
create policy "own profile insert" on profiles for insert with check (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);

-- weight logs
create policy "own weight logs" on daily_weight_logs for all using (auth.uid() = user_id);

-- water logs
create policy "own water logs" on water_logs for all using (auth.uid() = user_id);

-- progress photos
create policy "own progress photos" on progress_photos for all using (auth.uid() = user_id);

-- exercises
create policy "own exercises" on exercises for all using (auth.uid() = user_id);

-- workout folders
create policy "own folders select" on workout_folders for select using (auth.uid() = user_id);
create policy "own folders insert" on workout_folders for insert with check (auth.uid() = user_id);
create policy "own folders update" on workout_folders for update using (auth.uid() = user_id);
create policy "own folders delete" on workout_folders for delete using (auth.uid() = user_id);

-- workout sessions
create policy "own workout sessions" on workout_sessions for all using (auth.uid() = user_id);

-- workout sets (inherit from session ownership)
create policy "own workout sets" on workout_sets for all using (
  session_id in (select id from workout_sessions where user_id = auth.uid())
);

-- ─── Routine Exercises ──────────────────────────────────────
create table routine_exercises (
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
create policy "own routine exercises" on routine_exercises for all using (
  folder_id in (select id from workout_folders where user_id = auth.uid())
);

-- ─── Auto-create profile on signup ───────────────────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ─── Storage Buckets ─────────────────────────────────────────
-- Run these in the Supabase Dashboard → Storage → New Bucket:
--   1. "progress-photos"  (private, 10 MB file size limit)
--   2. "exercise-photos"  (private, 10 MB file size limit)
--
-- Then add storage policies:
--   allow authenticated users to upload to their own folder:
--     (storage.foldername(name))[1] = auth.uid()::text
