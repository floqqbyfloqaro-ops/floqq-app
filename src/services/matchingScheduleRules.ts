// "Next check in 3:12" on the "Finding your match" screen: when the matching job runs next, and
// whether it is running right now. The job is scheduled on the clock - every N minutes past the
// hour (0, 5, 10, ... for N = 5) - so its runs can be computed from the server's time alone.
//
// No imports, so this runs under a plain Node test.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// "Checking now..." is shown from a scheduled run until the server reports that run finished -
// but never longer than this: a run that failed must not leave the screen stuck.
export const CHECKING_MAX_MS = 30_000;

// The scheduled run at or before `nowMs`. Cron counts minutes within the hour, so the pattern
// starts again at every full hour.
export function previousRunMs(nowMs: number, intervalMinutes: number): number {
  const hourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const sinceHour = nowMs - hourStart;
  const intervalMs = intervalMinutes * MINUTE_MS;
  return hourStart + Math.floor(sinceHour / intervalMs) * intervalMs;
}

// The first scheduled run after `nowMs`.
export function nextRunMs(nowMs: number, intervalMinutes: number): number {
  const hourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const next = previousRunMs(nowMs, intervalMinutes) + intervalMinutes * MINUTE_MS;
  // A run that would fall past the hour is the run at the next full hour instead.
  return Math.min(next, hourStart + HOUR_MS);
}

export type MatchingCountdown = { kind: 'checking' } | { kind: 'countdown'; secondsLeft: number };

// `nowMs` is the server's time; `lastRunAtMs` when the job last finished (null: unknown).
export function matchingCountdown(nowMs: number, intervalMinutes: number, lastRunAtMs: number | null): MatchingCountdown {
  const previous = previousRunMs(nowMs, intervalMinutes);
  const finished = lastRunAtMs != null && lastRunAtMs >= previous;
  if (!finished && nowMs - previous < CHECKING_MAX_MS) return { kind: 'checking' };
  return { kind: 'countdown', secondsLeft: Math.max(0, Math.ceil((nextRunMs(nowMs, intervalMinutes) - nowMs) / 1000)) };
}

// 192 -> "3:12".
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
