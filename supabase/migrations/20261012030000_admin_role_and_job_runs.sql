-- Three things that belong together:
--   1. The matcher no longer needs a human account. A taxi group's created_by becomes optional
--      (null: formed by the system), and deleting an account no longer deletes the groups it
--      created.
--   2. Being the admin is a role (user_roles), checked for the current user by is_admin() - no
--      longer a hard-coded email address. Every access rule and function that compared the email
--      is rewritten in place to call is_admin(); the migration fails (and changes nothing) if one
--      is left over.
--   3. job_runs: per scheduled job, the last successful run and the last error, for the admin
--      dashboard.
--
-- Safe to run more than once.

-- 1. Groups formed by the system.
alter table public.taxi_groups alter column created_by drop not null;

do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.taxi_groups'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) ilike '%(created_by)%'
  loop
    execute format('alter table public.taxi_groups drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.taxi_groups
  add constraint taxi_groups_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- 2. The admin role.
create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- No client policies: nobody reads or changes roles through the app. is_admin() below answers
-- for the current user; roles are granted in the Supabase dashboard (or by a migration).
alter table public.user_roles enable row level security;

-- Is the current user an admin? A direct lookup of their own row - works the same with any
-- number of users. False without a logged-in user (the service role, the scheduled jobs).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- The account that was the admin by its email becomes the admin by role. One direct lookup, once.
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'floqqbyfloqaro@gmail.com'
on conflict do nothing;

-- Every access rule (tables and file storage) that compared the email.
do $$
declare
  pol record;
  email_check constant text :=
    '\(\s*auth\.jwt\(\)\s*->>\s*''email''(::text)?\s*\)\s*=\s*''floqqbyfloqaro@gmail\.com''(::text)?';
  new_qual text;
  new_check text;
  statement text;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where qual like '%floqqbyfloqaro@gmail.com%' or with_check like '%floqqbyfloqaro@gmail.com%'
  loop
    new_qual := regexp_replace(pol.qual, email_check, 'public.is_admin()', 'g');
    new_check := regexp_replace(pol.with_check, email_check, 'public.is_admin()', 'g');
    statement := format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    if new_qual is not null then
      statement := statement || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      statement := statement || format(' with check (%s)', new_check);
    end if;
    execute statement;
  end loop;

  if exists (
    select 1 from pg_policies
    where qual like '%floqqbyfloqaro@gmail.com%' or with_check like '%floqqbyfloqaro@gmail.com%'
  ) then
    raise exception 'an access rule still compares the admin email';
  end if;
end $$;

-- Every function that compared the email (the admin's group corrections, meeting point override,
-- "the ride took place"). Rewritten from its stored definition, so everything else about it -
-- body, security, who may call it - stays exactly as it is.
do $$
declare
  fn record;
  email_check constant text :=
    '\(\s*auth\.jwt\(\)\s*->>\s*''email''\s*\)\s+is\s+distinct\s+from\s+''floqqbyfloqaro@gmail\.com''';
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%floqqbyfloqaro@gmail.com%'
  loop
    execute regexp_replace(pg_get_functiondef(fn.oid), email_check, 'not public.is_admin()', 'gi');
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%floqqbyfloqaro@gmail.com%'
  ) then
    raise exception 'a function still compares the admin email';
  end if;
end $$;

-- 3. What the scheduled jobs last did. Written by the jobs themselves (service role).
create table if not exists public.job_runs (
  -- The function's name: 'match-and-group', 'match-offer-sweep', ...
  job text primary key,
  last_success_at timestamptz,
  -- What the last successful run reported (counts only).
  last_result jsonb,
  last_error_at timestamptz,
  last_error text
);

alter table public.job_runs enable row level security;

drop policy if exists "Admin can view job runs" on public.job_runs;
create policy "Admin can view job runs"
  on public.job_runs
  for select
  to authenticated
  using (public.is_admin());
