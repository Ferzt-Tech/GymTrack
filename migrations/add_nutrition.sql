-- ─── Food Intake Logs ──────────────────────────────────────────
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

-- Enable RLS
alter table food_logs enable row level security;

-- Setup RLS policy
drop policy if exists "own food logs" on food_logs;
create policy "own food logs" on food_logs for all using (auth.uid() = user_id);
