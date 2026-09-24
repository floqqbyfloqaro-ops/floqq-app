-- New accounts must verify their email before they can create a ride. With Supabase Auth's
-- "Confirm email" switched on, an unverified account can't log in at all, so this is a backstop:
-- it keeps the rule true even if that setting is ever switched off again (as it was before this
-- migration - every account from 11 Sep onwards was auto-confirmed). Google sign-ins arrive
-- already verified, so they pass.
create or replace function public.enforce_verified_email_for_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from auth.users
    where id = new.user_id
      and email_confirmed_at is not null
  ) then
    raise exception 'email_not_verified' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists passenger_requests_verified_email on public.passenger_requests;
create trigger passenger_requests_verified_email
  before insert on public.passenger_requests
  for each row execute function public.enforce_verified_email_for_request();
