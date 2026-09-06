-- personal_records: durable, append-only PR history.
--
-- ⚠️ RUN THIS IN THE SUPABASE SQL EDITOR BEFORE SHIPPING A CLIENT THAT WRITES
-- to personal_records. PostgREST rejects an upsert against a table that
-- doesn't exist at all (42P01) — the client already lists "personal_records"
-- in its local table registry (lib/tables.ts) in anticipation of this
-- migration, so any write attempted before this runs safely poison-pills
-- (see the 42P01 handling in lib/offlineQueue.ts) rather than looping, but
-- stays silently inert until this table exists.
--
-- One row per detected personal record — a newly logged set beating the
-- prior best weight for that exercise. Rows are never updated in place;
-- lib/personalRecords.ts / components/stats/PersonalRecords.tsx group the
-- full history by exercise_name and take the best e1rm per exercise, so a PR
-- set more than 60 days ago never has to disappear the way the previous
-- rolling-window recompute made it.

create table if not exists personal_records (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references auth.users(id) on delete cascade not null,
  exercise_id   uuid references exercises(id) on delete set null,
  exercise_name text not null,
  weight_kg     numeric(6,2) not null,
  reps          integer not null,
  -- e1RM (Epley/Brzycki average, see lib/oneRepMax.ts) — null outside the
  -- 1-12 rep range the formula is valid for. Still a real PR even when e1rm
  -- can't be estimated for it (e.g. a heavy single).
  e1rm          numeric(6,1),
  session_id    uuid references workout_sessions(id) on delete set null,
  achieved_at   date not null,
  created_at    timestamptz default now()
);
alter table personal_records enable row level security;
drop policy if exists "own personal records" on personal_records;
create policy "own personal records" on personal_records for all using (auth.uid() = user_id);
