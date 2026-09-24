import { BARCELONA_TIME_ZONE } from '../constants';

// Admin-dashboard-only: every date/time there is pinned to Barcelona local time, never the
// admin's own device time zone. arrival_at/created_at are stored as timestamptz (an absolute UTC
// instant - see supabase/migrations/20260911000000_create_passenger_requests.sql), so without an
// explicit timeZone here toLocaleString would render in whatever zone the device happens to be
// set to instead. Not used by passenger-facing screens - those intentionally show the
// passenger's own device time zone.
export function formatBarcelonaDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: BARCELONA_TIME_ZONE,
  });
}
