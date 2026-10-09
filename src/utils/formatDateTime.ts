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

const wallClockUtcMs = (date: Date) => {
  const { year, month, day, hour, minute } = barcelonaDateParts(date);
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
};

// The request form's date and time pickers work on the phone's own clock, but a ride's arrival is
// a time at Barcelona airport. So the form keeps "Barcelona wall-clock" dates: a Date whose local
// fields (the ones the pickers show and edit) read what a clock in Barcelona shows. These two
// convert between that and the real instant, so a passenger still abroad who types "14:35" means
// 14:35 in Barcelona, not 14:35 wherever their phone is.
export function toBarcelonaWallClock(instant: Date): Date {
  const { year, month, day, hour, minute } = barcelonaDateParts(instant);
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

export function fromBarcelonaWallClock(wallClock: Date): Date {
  const wallMs = Date.UTC(
    wallClock.getFullYear(),
    wallClock.getMonth(),
    wallClock.getDate(),
    wallClock.getHours(),
    wallClock.getMinutes()
  );
  // Barcelona's offset at a first guess, then again at the result: the second pass settles the
  // hours around a daylight-saving change.
  const offsetAt = (ms: number) => wallClockUtcMs(new Date(ms)) - ms;
  const firstGuess = wallMs - offsetAt(wallMs);
  return new Date(wallMs - offsetAt(firstGuess));
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
