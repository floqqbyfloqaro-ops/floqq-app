-- Meeting points, step 1: the places in the public arrivals area (after baggage claim, before the
-- exit) where a confirmed group can meet. This only adds the data model and the candidate points;
-- nothing assigns a point to a group yet, and every candidate starts inactive because none has
-- been verified on site.
--
-- Safe to run more than once.

-- 1. The points themselves.
create table if not exists public.meeting_points (
  id uuid primary key default gen_random_uuid(),
  airport_code text not null default 'BCN',
  terminal text not null check (terminal in ('T1', 'T2A', 'T2B', 'T2C')),
  -- What staff call it, e.g. 'T1-A'.
  short_code text not null unique,
  -- The wording shipped with the app (src/i18n/locales): the point's name, and how to walk there
  -- from the baggage claim exit.
  name_key text not null,
  directions_key text not null,
  -- Wording changed from the admin dashboard, one text per language ({"en": ..., "fr": ...,
  -- "es": ...}). Where a language is present here it is shown instead of the shipped wording.
  name_i18n jsonb,
  directions_i18n jsonb,
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  -- Path of the point's photo in the 'meeting-point-photos' bucket.
  photo_path text,
  -- Null: always reachable. Otherwise when the place is open (for cafés and the like).
  opening_hours jsonb,
  is_active boolean not null default false,
  -- Higher is preferred when a point is picked for a group.
  sort_priority integer not null default 0,
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint meeting_points_coordinates_together check ((latitude is null) = (longitude is null)),
  -- A point passengers are sent to must be findable: on the map and by its photo.
  constraint meeting_points_active_needs_details
    check (not is_active or (latitude is not null and longitude is not null and photo_path is not null))
);

create index if not exists meeting_points_terminal_idx
  on public.meeting_points (airport_code, terminal)
  where is_active;

alter table public.meeting_points enable row level security;

-- No personal data here: any logged-in user may read the points. Only the admin changes them.
drop policy if exists "Signed-in users can view meeting points" on public.meeting_points;
create policy "Signed-in users can view meeting points"
  on public.meeting_points
  for select
  to authenticated
  using (true);

drop policy if exists "Admin can manage meeting points" on public.meeting_points;
create policy "Admin can manage meeting points"
  on public.meeting_points
  for all
  to authenticated
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- 2. Which point a group meets at, and when. Both stay null until the assignment step exists.
alter table public.taxi_groups
  add column if not exists meeting_point_id uuid references public.meeting_points (id) on delete set null,
  add column if not exists meeting_time timestamptz;

-- 3. Photos of the points. Public: they show a place, never a person's data. Admin-only writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-point-photos', 'meeting-point-photos', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admin can upload meeting point photos" on storage.objects;
create policy "Admin can upload meeting point photos"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'meeting-point-photos' and (auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

drop policy if exists "Admin can replace meeting point photos" on storage.objects;
create policy "Admin can replace meeting point photos"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'meeting-point-photos' and (auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com')
  with check (bucket_id = 'meeting-point-photos' and (auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

drop policy if exists "Admin can delete meeting point photos" on storage.objects;
create policy "Admin can delete meeting point photos"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'meeting-point-photos' and (auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- 4. The candidates. None is verified on site yet: all inactive, no coordinates, no photo.
insert into public.meeting_points (terminal, short_code, name_key, directions_key, sort_priority)
values
  ('T1', 'T1-A', 'meetingPoints.T1-A.name', 'meetingPoints.T1-A.directions', 50),
  ('T1', 'T1-B', 'meetingPoints.T1-B.name', 'meetingPoints.T1-B.directions', 40),
  ('T1', 'T1-C', 'meetingPoints.T1-C.name', 'meetingPoints.T1-C.directions', 30),
  ('T1', 'T1-D', 'meetingPoints.T1-D.name', 'meetingPoints.T1-D.directions', 20),
  ('T1', 'T1-E', 'meetingPoints.T1-E.name', 'meetingPoints.T1-E.directions', 10),
  ('T2B', 'T2-A', 'meetingPoints.T2-A.name', 'meetingPoints.T2-A.directions', 40),
  ('T2B', 'T2-B', 'meetingPoints.T2-B.name', 'meetingPoints.T2-B.directions', 30),
  ('T2B', 'T2-C', 'meetingPoints.T2-C.name', 'meetingPoints.T2-C.directions', 20),
  ('T2B', 'T2-D', 'meetingPoints.T2-D.name', 'meetingPoints.T2-D.directions', 10)
on conflict (short_code) do nothing;
