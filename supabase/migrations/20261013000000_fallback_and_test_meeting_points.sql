-- Meeting points: a confirmed group always has one.
--   1. Every point has a kind:
--        'regular'  - a landmark passengers are sent to: coordinates, a photo, wording and an
--                     on-site verification before it may be active (as before);
--        'fallback' - one per terminal (T1, T2B): the arrivals hall itself with generic wording.
--                     Active with coordinates alone; only used when no regular point is active
--                     at the terminal (_shared/meetingPointAssignment.ts). The admin sees which
--                     groups got it, and picks them a real point.
--        'test'     - for trying things out on the test project: active without a photo or an
--                     on-site check. Only where environment_settings allows them, which no
--                     migration ever does - it is switched on by hand in the test project only.
--   2. The two fallback points, active, with approximate coordinates of each arrivals hall: the
--      admin corrects them in the meeting-points manager.
--
-- Safe to run more than once.

-- 1. The kind.
alter table public.meeting_points
  add column if not exists kind text not null default 'regular';

alter table public.meeting_points
  drop constraint if exists meeting_points_kind_check;
alter table public.meeting_points
  add constraint meeting_points_kind_check check (kind in ('regular', 'fallback', 'test'));

-- One fallback per terminal.
create unique index if not exists meeting_points_one_fallback_per_terminal
  on public.meeting_points (airport_code, terminal)
  where kind = 'fallback';

-- An active point is always on the map. A regular one also needs its photo and the on-site check.
alter table public.meeting_points
  drop constraint if exists meeting_points_active_needs_details;
alter table public.meeting_points
  add constraint meeting_points_active_needs_details
  check (
    not is_active
    or (
      latitude is not null
      and longitude is not null
      and (kind <> 'regular' or (photo_path is not null and verified_at is not null))
    )
  );

-- 2. What this database allows that the live one never does. One row, readable by any signed-in
-- user (the admin tool shows the TEST option only where it applies); no client may change it.
create table if not exists public.environment_settings (
  id boolean primary key default true check (id),
  allow_test_meeting_points boolean not null default false
);
insert into public.environment_settings (id) values (true) on conflict (id) do nothing;

alter table public.environment_settings enable row level security;
drop policy if exists "Signed-in users can view environment settings" on public.environment_settings;
create policy "Signed-in users can view environment settings"
  on public.environment_settings
  for select
  to authenticated
  using (true);

-- TEST points can't be created, or turned into, anywhere they aren't allowed.
create or replace function public.meeting_points_guard_test_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'test'
     and not coalesce((select allow_test_meeting_points from public.environment_settings where id), false) then
    raise exception 'test meeting points are not allowed in this environment' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists meeting_points_guard_test_kind on public.meeting_points;
create trigger meeting_points_guard_test_kind
  before insert or update of kind on public.meeting_points
  for each row execute function public.meeting_points_guard_test_kind();

-- 3. The fallback points. Coordinates: roughly the middle of each arrivals hall.
insert into public.meeting_points
  (terminal, short_code, name_key, directions_key, latitude, longitude, kind, is_active, sort_priority)
values
  ('T1', 'T1-FALLBACK', 'meetingPoints.T1-FALLBACK.name', 'meetingPoints.T1-FALLBACK.directions',
   41.28870, 2.07330, 'fallback', true, 0),
  ('T2B', 'T2-FALLBACK', 'meetingPoints.T2-FALLBACK.name', 'meetingPoints.T2-FALLBACK.directions',
   41.30360, 2.07840, 'fallback', true, 0)
on conflict (short_code) do nothing;
