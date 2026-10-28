-- Avatars: each passenger picks one of the app's illustrated avatars, and the other members of
-- their group see it.
--   1. profiles.avatar_id: which avatar (the app's registry maps the id to an image; an id the app
--      doesn't know shows a neutral default). 1-99 is accepted, so a new avatar only needs the app.
--   2. Existing accounts get a random one now - once, stored, never re-rolled.
--   3. Sign-up: the avatar chosen on the "Choose your avatar" step travels with the new account
--      (avatar_id in the user metadata); without one (Google, older app versions), a random one.
--   4. set_my_avatar: the passenger changes it from their profile.
-- Other passengers never read profiles: their avatar reaches them through the match-offer and
-- find-group functions, like their first name.
--
-- Safe to run more than once.

-- A random one of the app's first eight avatars.
create or replace function public.random_avatar_id()
returns smallint
language sql
volatile
as $$
  select (1 + floor(random() * 8))::smallint;
$$;

-- 1 + 2. The column. A volatile default is evaluated per row when the column is added, so each
-- existing account gets its own random avatar, once.
alter table public.profiles
  add column if not exists avatar_id smallint not null default public.random_avatar_id();

alter table public.profiles drop constraint if exists profiles_avatar_id_range;
alter table public.profiles
  add constraint profiles_avatar_id_range check (avatar_id between 1 and 99);

-- 3. The new account's profile (as in 20261022000000_profiles_and_minimum_age.sql), now with the
-- avatar from the sign-up form when it sent a valid one.
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
  v_avatar_text text := btrim(coalesce(v_meta ->> 'avatar_id', ''));
  v_avatar smallint;
begin
  if v_first = '' and v_full <> '' then
    v_first := split_part(v_full, ' ', 1);
    v_last := btrim(substr(v_full, char_length(v_first) + 1));
  end if;
  if v_avatar_text ~ '^[0-9]{1,2}$' and v_avatar_text::int between 1 and 99 then
    v_avatar := v_avatar_text::smallint;
  else
    v_avatar := public.random_avatar_id();
  end if;
  insert into public.profiles (user_id, first_name, last_name, date_of_birth, avatar_id)
  values (new.id, left(v_first, 50), left(v_last, 50), nullif(btrim(v_meta ->> 'date_of_birth'), '')::date, v_avatar)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 4. The passenger's own choice.
create or replace function public.set_my_avatar(p_avatar_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_avatar_id is null or p_avatar_id not between 1 and 99 then
    raise exception 'invalid_avatar' using errcode = '22023';
  end if;

  insert into public.profiles (user_id, avatar_id)
  values (auth.uid(), p_avatar_id)
  on conflict (user_id) do update set avatar_id = excluded.avatar_id;

  return jsonb_build_object('avatar_id', p_avatar_id);
end;
$$;

revoke all on function public.set_my_avatar(integer) from public, anon;
grant execute on function public.set_my_avatar(integer) to authenticated;
