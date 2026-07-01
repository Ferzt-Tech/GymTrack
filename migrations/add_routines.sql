-- ─── Workout Folders ─────────────────────────────────────────
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

-- ─── Routine Exercises ────────────────────────────────────────
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
