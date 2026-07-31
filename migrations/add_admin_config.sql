-- ============================================================
-- Admin panel: per-user Gemini API key + a global "AI scanner
-- enabled for everyone" flag.
-- ============================================================

-- gemini_api_key: each user's own key, synced via the existing profiles
-- RLS (auth.uid() = id) — no policy change needed on profiles.
alter table profiles add column if not exists gemini_api_key text;

-- app_settings: single-row global config, readable by anyone (no sensitive
-- data in it), writable only by the allowlisted admin account. The email
-- check mirrors DEV_EMAILS in lib/devMode.ts — update both if that list
-- ever grows beyond one account.
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
