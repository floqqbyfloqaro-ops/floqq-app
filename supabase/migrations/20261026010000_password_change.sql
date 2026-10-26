-- "Change password" in Profile (supabase/functions/change-password). Each wrong current password
-- is recorded with its time only - never the password itself - so 5 wrong tries within 15 minutes
-- can make the passenger wait 15 minutes. A successful change is recorded as a profile_events row
-- ('password_changed', with its timestamp and nothing else).
--
-- Only the change-password function (service role) reads or writes this table: row level security
-- is on and there are no policies.
--
-- Safe to run more than once.

create table if not exists public.password_change_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  failed_at timestamptz not null default now()
);

create index if not exists password_change_attempts_user_idx on public.password_change_attempts (user_id, failed_at desc);

alter table public.password_change_attempts enable row level security;
