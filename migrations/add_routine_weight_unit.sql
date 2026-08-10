-- Per-exercise weight unit on planned routine exercises.
--
-- ⚠️ RUN THIS IN THE SUPABASE SQL EDITOR BEFORE SHIPPING A CLIENT THAT WRITES
-- routine_exercises.weight_unit. PostgREST rejects an ENTIRE upsert over one
-- unknown column, so a client writing a column the remote table lacks breaks
-- cloud sync/backup for routine_exercises wholesale — not just for that field.
-- (Guests never sync, so they are unaffected either way.)
--
-- planned_weight_kg stays canonical kilograms. weight_unit only records the unit
-- the user wants to read and enter that weight in, exactly like
-- workout_sets.weight_unit. NULL means "inherit the profile's unit", which is
-- what every pre-existing row gets — so this needs no data backfill.

alter table routine_exercises
  add column if not exists weight_unit text
  check (weight_unit in ('kg','lbs'));

-- set_type has been written by the app since the set-type feature shipped but
-- was never in a base migration (add_routines.sql / schema.sql both predate it).
-- Any project that hasn't hand-added it is silently failing every
-- routine_exercises sync, so it is repaired here alongside the new column.
alter table routine_exercises
  add column if not exists set_type text not null default 'normal'
  check (set_type in ('normal','warmup','dropset'));
