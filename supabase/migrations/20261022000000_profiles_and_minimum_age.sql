-- Profiles, step A: the passenger's own name and date of birth, and the minimum age of 18.
--   1. profiles: first name, last name and date of birth per account. Only its owner (and the
--      admin) can read it; nobody writes it directly - only through the functions below. Other
--      passengers only ever see the first name, and never through this table.
--   2. The age rule, on the server: 18 or older on the (Barcelona) day the date is entered - an
--      18th birthday today counts. A sign-up with a younger date is refused, so no account and
--      no data exist. An existing account that enters one keeps it, flagged (under_age_at), and
--      its rides are refused while it is under 18.
--   3. The date of birth is set once. Only the admin corrects it afterwards
--      (admin_set_date_of_birth), recorded in profile_events.
--   4. Rides: created or edited by a passenger only with a date of birth showing 18 or older;
--      their passenger name comes from the profile.
--   5. Existing accounts get a profile now: their name split into first word / the rest.
--
-- Safe to run more than once.

-- 1. The table.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  -- A date only, never a time. Used for the age check and nothing else.
  date_of_birth date check (date_of_birth is null or date_of_birth >= date '1900-01-01'),
  -- When a date showing under 18 was entered for this (existing) account: the admin's flag.
  under_age_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- What happened to a profile that matters later: a date of birth entered, or corrected by the
-- admin. The admin reads it; it is written by the functions below only.
create table if not exists public.profile_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  details jsonb,
  actor_type text not null check (actor_type in ('user', 'admin', 'system')),
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists profile_events_user_idx on public.profile_events (user_id, created_at desc);

alter table public.profile_events enable row level security;

drop policy if exists "Admin can view profile events" on public.profile_events;
create policy "Admin can view profile events"
  on public.profile_events
  for select
  to authenticated
  using (public.is_admin());

-- 2. The rules.

-- Today in Barcelona: "on the day they enter it" is the airport's day, whatever the server's.
create or replace function public.barcelona_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Europe/Madrid')::date;
$$;

-- 18 or older on that day. Someone born on 29 February turns 18 on 1 March in a non-leap year.
create or replace function public.is_adult_on(p_date_of_birth date, p_day date)
returns boolean
language sql
immutable
as $$
  select p_date_of_birth <= (p_day - interval '18 years')::date;
$$;

-- A name as typed, tidied: composed accents, no outer spaces, single spaces inside.
create or replace function public.clean_person_name(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(btrim(normalize(coalesce(p_name, ''), NFC)), '\s+', ' ', 'g');
$$;

-- 1-50 characters: letters of any alphabet (accents included), spaces, hyphens and apostrophes,
-- with at least one letter. "José", "Anne-Marie", "O'Neil", "'t Hooft".
create or replace function public.valid_person_name(p_name text)
returns boolean
language sql
immutable
as $$
  select char_length(p_name) between 1 and 50
     and p_name ~ '^[[:alpha:] ''’-]+$'
     and p_name ~ '[[:alpha:]]';
$$;

-- Guards every write to a profile, whoever makes it.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > public.barcelona_today() then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE'
     and old.date_of_birth is not null
     and new.date_of_birth is distinct from old.date_of_birth
     and coalesce(current_setting('floqq.allow_date_of_birth_change', true), '') <> 'on' then
    raise exception 'date_of_birth_locked' using errcode = '42501';
  end if;

  if new.date_of_birth is not null
     and (tg_op = 'INSERT' or new.date_of_birth is distinct from old.date_of_birth) then
    if public.is_adult_on(new.date_of_birth, public.barcelona_today()) then
      -- An admin correction to an adult date lifts the flag (profile_events keeps the history).
      new.under_age_at := null;
    else
      new.under_age_at := coalesce(new.under_age_at, now());
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- 3. Sign-up: the app sends first_name, last_name and date_of_birth ('YYYY-MM-DD') with the new
-- account. A date showing under 18 refuses the sign-up outright - the account is never created.
-- Accounts without a date (Google, older app versions) are asked for it before their first ride.
create or replace function public.auth_user_check_age()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text := nullif(btrim(new.raw_user_meta_data ->> 'date_of_birth'), '');
  v_date date;
begin
  if v_text is null then
    return new;
  end if;
  begin
    v_date := v_text::date;
  exception when others then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end;
  if v_date > public.barcelona_today() or v_date < date '1900-01-01' then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end if;
  if not public.is_adult_on(v_date, public.barcelona_today()) then
    raise exception 'under_age' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The new account's profile. Names from the sign-up form, else split from the full name the
-- provider gives (Google: full_name or name).
create or replace function public.auth_user_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_full text := public.clean_person_name(coalesce(v_meta ->> 'full_name', v_meta ->> 'name', ''));
  v_first text := public.clean_person_name(v_meta ->> 'first_name');
  v_last text := public.clean_person_name(v_meta ->> 'last_name');
begin
  if v_first = '' and v_full <> '' then
    v_first := split_part(v_full, ' ', 1);
    v_last := btrim(substr(v_full, char_length(v_first) + 1));
  end if;
  insert into public.profiles (user_id, first_name, last_name, date_of_birth)
  values (new.id, left(v_first, 50), left(v_last, 50), nullif(btrim(v_meta ->> 'date_of_birth'), '')::date)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_user_check_age on auth.users;
create trigger auth_user_check_age
  before insert on auth.users
  for each row execute function public.auth_user_check_age();

drop trigger if exists auth_user_create_profile on auth.users;
create trigger auth_user_create_profile
  after insert on auth.users
  for each row execute function public.auth_user_create_profile();

-- 4. What a passenger can do with their own profile.

-- Their name: also what their open rides carry, so the other members of their group see the new
-- first name straight away.
create or replace function public.update_my_name(p_first_name text, p_last_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := public.clean_person_name(p_first_name);
  v_last text := public.clean_person_name(p_last_name);
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not public.valid_person_name(v_first) then
    raise exception 'invalid_first_name' using errcode = '22023';
  end if;
  if not public.valid_person_name(v_last) then
    raise exception 'invalid_last_name' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, first_name, last_name)
  values (auth.uid(), v_first, v_last)
  on conflict (user_id) do update set first_name = excluded.first_name, last_name = excluded.last_name;

  update public.passenger_requests
  set passenger_name = v_first || ' ' || v_last
  where user_id = auth.uid() and status in ('pending', 'matched');

  return jsonb_build_object('first_name', v_first, 'last_name', v_last);
end;
$$;

-- Their date of birth, once. Under 18: kept and flagged (status 'under_age'), and rides refused.
create or replace function public.set_my_date_of_birth(p_date_of_birth date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing date;
  v_under_age boolean;
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_date_of_birth is null then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end if;

  select date_of_birth into v_existing from public.profiles where user_id = auth.uid() for update;
  if v_existing is not null then
    raise exception 'date_of_birth_locked' using errcode = '42501';
  end if;

  insert into public.profiles (user_id, date_of_birth)
  values (auth.uid(), p_date_of_birth)
  on conflict (user_id) do update set date_of_birth = excluded.date_of_birth;

  v_under_age := not public.is_adult_on(p_date_of_birth, public.barcelona_today());
  insert into public.profile_events (user_id, event_type, details, actor_type, actor_id)
  values (auth.uid(), 'date_of_birth_set', jsonb_build_object('under_age', v_under_age), 'user', auth.uid());

  return jsonb_build_object('status', case when v_under_age then 'under_age' else 'saved' end);
end;
$$;

-- Withdraws a pending email change: the confirmation links stop working and the current email
-- stays. (Supabase has no client call for this.)
create or replace function public.cancel_my_email_change()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update auth.users
  set email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      email_change_confirm_status = 0,
      email_change_sent_at = null
  where id = auth.uid();
  return jsonb_build_object('cancelled', true);
end;
$$;

revoke all on function public.update_my_name(text, text) from public, anon;
revoke all on function public.set_my_date_of_birth(date) from public, anon;
revoke all on function public.cancel_my_email_change() from public, anon;
grant execute on function public.update_my_name(text, text) to authenticated;
grant execute on function public.set_my_date_of_birth(date) to authenticated;
grant execute on function public.cancel_my_email_change() to authenticated;

-- 5. Rides. A passenger creating or editing one needs a date of birth showing 18 or older today.
-- Only the passenger's own writes are checked: system jobs (no auth.uid()) keep updating flight
-- times, and cancelling a ride is never blocked. A new ride carries the profile's name.
create or replace function public.passenger_requests_require_adult()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where user_id = new.user_id;

  if tg_op = 'INSERT' and found and v_profile.first_name <> '' then
    new.passenger_name := btrim(v_profile.first_name || ' ' || v_profile.last_name);
  end if;

  if auth.uid() is null or auth.uid() is distinct from new.user_id then
    return new;
  end if;
  if v_profile.date_of_birth is null then
    raise exception 'date_of_birth_required' using errcode = '42501';
  end if;
  if not public.is_adult_on(v_profile.date_of_birth, public.barcelona_today()) then
    raise exception 'under_age' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists passenger_requests_require_adult on public.passenger_requests;
create trigger passenger_requests_require_adult
  before insert or update of flight_number, arrival_at, destination_address, destination_lat, destination_lng,
    large_luggage_count, hand_luggage_count, max_wait_minutes
  on public.passenger_requests
  for each row execute function public.passenger_requests_require_adult();

-- 6. The admin.

-- Accounts flagged under 18, newest first.
create or replace function public.admin_under_age_accounts()
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  date_of_birth date,
  under_age_at timestamptz,
  still_under_age boolean
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select p.user_id, u.email::text, p.first_name, p.last_name, p.date_of_birth, p.under_age_at,
           not public.is_adult_on(p.date_of_birth, public.barcelona_today())
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where p.under_age_at is not null
    order by p.under_age_at desc;
end;
$$;

-- One account by its exact email (case ignored), to correct its date of birth.
create or replace function public.admin_find_account(p_email text)
returns table (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  date_of_birth date,
  under_age_at timestamptz,
  provider text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, coalesce(p.first_name, ''), coalesce(p.last_name, ''), p.date_of_birth,
           p.under_age_at, coalesce(u.raw_app_meta_data ->> 'provider', 'email')
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    where lower(u.email) = lower(btrim(p_email))
    limit 1;
end;
$$;

-- The admin corrects a date of birth (the only way to change one once set), with a note on why.
create or replace function public.admin_set_date_of_birth(p_user_id uuid, p_date_of_birth date, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous date;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_date_of_birth is null then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  select date_of_birth into v_previous from public.profiles where user_id = p_user_id for update;

  perform set_config('floqq.allow_date_of_birth_change', 'on', true);
  insert into public.profiles (user_id, date_of_birth)
  values (p_user_id, p_date_of_birth)
  on conflict (user_id) do update set date_of_birth = excluded.date_of_birth;
  perform set_config('floqq.allow_date_of_birth_change', '', true);

  insert into public.profile_events (user_id, event_type, details, actor_type, actor_id)
  values (p_user_id, 'date_of_birth_corrected',
          jsonb_build_object('from', v_previous, 'to', p_date_of_birth, 'note', nullif(btrim(coalesce(p_note, '')), '')),
          'admin', auth.uid());

  return jsonb_build_object(
    'applied', true,
    'under_age', not public.is_adult_on(p_date_of_birth, public.barcelona_today())
  );
end;
$$;

revoke all on function public.admin_under_age_accounts() from public, anon;
revoke all on function public.admin_find_account(text) from public, anon;
revoke all on function public.admin_set_date_of_birth(uuid, date, text) from public, anon;
grant execute on function public.admin_under_age_accounts() to authenticated;
grant execute on function public.admin_find_account(text) to authenticated;
grant execute on function public.admin_set_date_of_birth(uuid, date, text) to authenticated;

-- 7. Existing accounts: a profile each, the name split from what the account already has.
insert into public.profiles (user_id, first_name, last_name)
select u.id,
       left(split_part(n.full_name, ' ', 1), 50),
       left(btrim(substr(n.full_name, char_length(split_part(n.full_name, ' ', 1)) + 1)), 50)
from auth.users u
cross join lateral (
  select public.clean_person_name(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')) as full_name
) n
on conflict (user_id) do nothing;
