-- Meeting points are landmarks only: passengers meet in front of the café, office or statue
-- whether or not it is open. So there are no opening hours, and nothing will ever skip a point
-- because it is closed.
--
-- A point can also only be active once an admin has verified it on site - on top of having
-- coordinates and a photo. (Wording in every supported language is checked by the admin tool; the
-- shipped wording lives in the app, not in the database.)
--
-- Safe to run more than once.

alter table public.meeting_points
  drop column if exists opening_hours;

alter table public.meeting_points
  drop constraint if exists meeting_points_active_needs_details;

alter table public.meeting_points
  add constraint meeting_points_active_needs_details
  check (
    not is_active
    or (latitude is not null and longitude is not null and photo_path is not null and verified_at is not null)
  );
