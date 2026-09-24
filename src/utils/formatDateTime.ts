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

export type BarcelonaDateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BARCELONA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// Zero-padded calendar/clock fields of an instant as seen in Barcelona, so the admin screens can
// build fixed dd/mm/yyyy and HH:mm strings regardless of the device's locale or zone.
export function barcelonaDateParts(date: Date | string): BarcelonaDateParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(new Date(date))) {
    parts[part.type] = part.value;
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

// "YYYY-MM-DD" of the Barcelona calendar day an instant falls on - used to bucket rides by day.
export function barcelonaDayKey(date: Date | string): string {
  const { year, month, day } = barcelonaDateParts(date);
  return `${year}-${month}-${day}`;
}

// Shifts a day key by whole calendar days. Done on the key itself rather than adding 24h to an
// instant, which lands on the wrong day around DST changes.
export function addDaysToDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Short weekday ("Thu", "jue", "jeu.") in the app's language, for the Barcelona day of the instant.
export function barcelonaWeekday(date: Date | string, language: string): string {
  return new Date(date).toLocaleDateString(language, { weekday: 'short', timeZone: BARCELONA_TIME_ZONE });
}

// Same weekday for a day key (noon UTC is always the same calendar day in Barcelona).
export function weekdayForDayKey(dayKey: string, language: string): string {
  return barcelonaWeekday(`${dayKey}T12:00:00Z`, language);
}
