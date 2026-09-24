-- Records where a request's arrival_at came from, so the admin dashboard can tell a landing time
-- pulled from flight data apart from one the passenger typed in by hand:
--   'flight' - filled from the FlightAware lookup (NewRequestScreen) or later overwritten by the
--              recheck-landing-times job
--   'manual' - entered by the passenger with the time picker
-- Nullable on purpose: rows created before this column existed have no reliable source, so they
-- stay null and the admin UI simply shows no indicator for them rather than guessing.
alter table public.passenger_requests
  add column if not exists arrival_time_source text
  check (arrival_time_source in ('flight', 'manual'));
