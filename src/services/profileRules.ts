// The pure rules around a passenger's profile - no imports, so a plain Node test loads this file
// directly (profileRules.test.mjs). The server holds the same rules and has the last word
// (supabase/migrations/20261022000000_profiles_and_minimum_age.sql): these only let the app say
// what is wrong before anything is sent.

export const NAME_MAX_LENGTH = 50;
export const MINIMUM_AGE = 18;

// A name as typed, tidied: composed accents, no outer spaces, single spaces inside.
export function cleanPersonName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}

// 1-50 characters: letters of any alphabet (accents included), spaces, hyphens and apostrophes,
// with at least one letter. "José", "Anne-Marie", "O'Neil", "'t Hooft".
export function isValidPersonName(name: string): boolean {
  const cleaned = cleanPersonName(name);
  const length = [...cleaned].length;
  return (
    length >= 1 &&
    length <= NAME_MAX_LENGTH &&
    /^[\p{L}\p{M} '’-]+$/u.test(cleaned) &&
    /\p{L}/u.test(cleaned)
  );
}

// A calendar date without a time: what a date of birth is.
export type CalendarDate = { year: number; month: number; day: number };

// 'YYYY-MM-DD', as the server stores it.
export function toIsoDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseIsoDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return check.getUTCFullYear() === date.year && check.getUTCMonth() === date.month - 1 && check.getUTCDate() === date.day
    ? date
    : null;
}

// The same day `years` earlier; a 29 February lands on 28 February in a non-leap year.
function yearsBefore(day: CalendarDate, years: number): CalendarDate {
  const year = day.year - years;
  const lastDay = new Date(Date.UTC(year, day.month, 0)).getUTCDate();
  return { year, month: day.month, day: Math.min(day.day, lastDay) };
}

const compare = (a: CalendarDate, b: CalendarDate) => a.year - b.year || a.month - b.month || a.day - b.day;

// 18 or older on `today`: an 18th birthday today counts. Someone born on 29 February turns 18 on
// 1 March in a non-leap year.
export function isAdultOn(dateOfBirth: CalendarDate, today: CalendarDate): boolean {
  return compare(dateOfBirth, yearsBefore(today, MINIMUM_AGE)) <= 0;
}

// Today in Barcelona, where the age is counted (as on the server).
export function barcelonaToday(now: Date = new Date()): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

// A plausible email address - the server (Supabase Auth) checks it properly.
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}
