-- Push notifications (Expo push service) for the payments prototype: one row per phone that has
-- allowed notifications, with the phone's language so the server can send the message in it.
-- Phones register/unregister through the two functions below (a token moves to whoever last
-- logged in on that phone); only Edge Functions (service role) read the table to send pushes.
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  locale text not null default 'en' check (locale in ('en', 'es', 'fr')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "Users can view their own push tokens"
  on public.push_tokens
  for select
  using (auth.uid() = user_id);

create or replace function public.register_push_token(p_token text, p_platform text, p_locale text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.push_tokens (token, user_id, platform, locale)
  values (p_token, auth.uid(), p_platform, case when p_locale in ('en', 'es', 'fr') then p_locale else 'en' end)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        locale = excluded.locale,
        last_seen_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- Each hold notification goes out once per situation (reset when a new amount must be reserved).
alter table public.ride_payments
  add column if not exists hold_open_notified_at timestamptz,
  add column if not exists hold_reminder_sent_at timestamptz,
  -- "removed from group" / "group dissolved" message sent.
  add column if not exists ended_notified_at timestamptz;

-- Rows created before notifications existed count as already notified, so switching this on
-- doesn't send stale messages about earlier (test) rides.
update public.ride_payments
set hold_open_notified_at = coalesce(hold_open_notified_at, now()),
    hold_reminder_sent_at = coalesce(hold_reminder_sent_at, now()),
    ended_notified_at = coalesce(ended_notified_at, now());
