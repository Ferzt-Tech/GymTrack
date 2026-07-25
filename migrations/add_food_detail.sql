-- Extended nutrition detail for foods (sugars, fiber, saturated fat, sodium,
-- vitamins/minerals, Nutri-Score, NOVA, brand, category, serving info).
--
-- Stored as a single jsonb column per table, mirroring the `drops jsonb`
-- pattern on workout_sets: one column, no future migration needed to add more
-- nutrients, and the local-first sync/backup pipeline carries it through
-- generically (executeLocalOp / MockQueryBuilder / backupToCloud all spread
-- arbitrary columns).
--
-- Shape of `detail` (all numeric nutrient values in GRAMS, per-100g on
-- saved_foods and per-serving on food_logs):
--   {
--     "brand": "Optimum Nutrition", "category": "Supplements", "code": "748927024074",
--     "servingSize": "1 scoop (30 g)", "servingGrams": 30,
--     "sugars_g": 2, "fiber_g": 0.5, "satFat_g": 0.5, "sodium_g": 0.05, "salt_g": 0.12,
--     "micros": { "vitamin-c": 0.012, "calcium": 0.12, "iron": 0.002 },
--     "nutriScore": "a", "novaGroup": 4, "source": "off"
--   }
--
-- This script is idempotent and self-healing: it (re)creates the food_logs and
-- saved_foods tables if they are missing — e.g. if migrations/changes.sql (which
-- first defined saved_foods) was never applied to this project — then adds the
-- columns. Safe to run multiple times.
--
-- ⚠️ Apply this in Supabase BEFORE a signed-in client writes `detail`.
-- backupToCloud/flushQueue upload every local column and do NOT strip unknown
-- ones for these two tables, so a missing remote column makes PostgREST reject
-- the ENTIRE upsert — breaking cloud sync/backup wholesale. (Guest mode never
-- syncs, so it is unaffected.)

-- ── food_logs (from add_nutrition.sql) ──────────────────────────────────────
create table if not exists food_logs (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references auth.users(id) on delete cascade not null,
  logged_date   date not null default current_date,
  meal_type     text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_name     text not null,
  calories      numeric(6,1) not null default 0,
  protein_g     numeric(5,1) not null default 0,
  carbs_g       numeric(5,1) not null default 0,
  fats_g        numeric(5,1) not null default 0,
  weight_g      numeric(6,1) default null,
  created_at    timestamptz default now()
);
alter table food_logs enable row level security;
drop policy if exists "own food logs" on food_logs;
create policy "own food logs" on food_logs for all using (auth.uid() = user_id);

alter table food_logs add column if not exists updated_at timestamptz default now();
alter table food_logs add column if not exists detail jsonb;

-- ── saved_foods (from changes.sql) ──────────────────────────────────────────
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

alter table saved_foods add column if not exists detail jsonb;
