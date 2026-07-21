-- ============================================================
-- GymTrack — Incremental Changes
-- Paste snippets from this file into:
--   Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ─── Add a column ────────────────────────────────────────────
-- alter table profiles add column if not exists avatar_url text;

-- ─── Drop a column ───────────────────────────────────────────
-- alter table profiles drop column if exists avatar_url;

-- ─── Create a new table ──────────────────────────────────────
-- create table if not exists your_table (
--   id          uuid default uuid_generate_v4() primary key,
--   user_id     uuid references auth.users(id) on delete cascade not null,
--   created_at  timestamptz default now()
-- );
-- alter table your_table enable row level security;
-- drop policy if exists "own your_table" on your_table;
-- create policy "own your_table" on your_table
--   for all using (auth.uid() = user_id);

-- ─── Add / replace an RLS policy ─────────────────────────────
-- drop policy if exists "policy name" on some_table;
-- create policy "policy name" on some_table
--   for all using (auth.uid() = user_id);

-- ─── Add an index ────────────────────────────────────────────
-- create index if not exists idx_name on table_name(column_name);

-- ─── Rename a column ─────────────────────────────────────────
-- alter table profiles rename column old_name to new_name;

-- ============================================================
-- Write your changes below this line
-- ============================================================

-- Add weight_unit column to workout_sets to record the specific unit used during the workout log.
alter table workout_sets add column if not exists weight_unit text default 'kg' check (weight_unit in ('kg', 'lbs'));

-- Add updated_at to food_logs so an edited log (upsert-merge on existing id) can sync —
-- without this column PostgREST rejects the upsert once a log is edited in place.
alter table food_logs add column if not exists updated_at timestamptz default now();

-- Saved/Favorite Foods — quick re-log of frequently eaten items (per-100g reference, like an OFF item).
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
alter table saved_foods enable row level security;
drop policy if exists "own saved foods" on saved_foods;
create policy "own saved foods" on saved_foods for all using (auth.uid() = user_id);
