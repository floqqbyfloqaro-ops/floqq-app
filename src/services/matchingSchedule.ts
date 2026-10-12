import { MATCHING_INTERVAL_MINUTES } from '../constants';
import { supabase } from './supabase';

export type MatchingSchedule = {
  // How often the matching job runs, as the server has it scheduled.
  intervalMinutes: number;
  // When it last finished; null when unknown.
  lastRunAtMs: number | null;
  // The server's clock minus this phone's: added to Date.now() it gives the server's time.
  clockOffsetMs: number;
};

// What the screen shows until the server has answered, or when it can't be reached: the
// configured interval, counted on the phone's own clock.
export const DEFAULT_MATCHING_SCHEDULE: MatchingSchedule = {
  intervalMinutes: MATCHING_INTERVAL_MINUTES,
  lastRunAtMs: null,
  clockOffsetMs: 0,
};

// The matching job's schedule (get_matching_schedule: nothing personal, any logged-in user).
// Null when it couldn't be read.
export async function fetchMatchingSchedule(): Promise<MatchingSchedule | null> {
  const askedAt = Date.now();
  const { data, error } = await supabase.rpc('get_matching_schedule');
  if (error || !data) {
    if (error) console.warn('get_matching_schedule failed', error.message);
    return null;
  }

  const answer = data as { interval_minutes: number | null; last_run_at: string | null; server_now: string };
  const serverNowMs = new Date(answer.server_now).getTime();
  // The answer was produced somewhere between asking and receiving: take the middle.
  const receivedAt = Date.now();
  return {
    intervalMinutes:
      typeof answer.interval_minutes === 'number' && answer.interval_minutes > 0
        ? answer.interval_minutes
        : MATCHING_INTERVAL_MINUTES,
    lastRunAtMs: answer.last_run_at ? new Date(answer.last_run_at).getTime() : null,
    clockOffsetMs: Number.isNaN(serverNowMs) ? 0 : serverNowMs - (askedAt + receivedAt) / 2,
  };
}
