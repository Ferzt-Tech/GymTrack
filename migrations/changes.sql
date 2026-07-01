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
