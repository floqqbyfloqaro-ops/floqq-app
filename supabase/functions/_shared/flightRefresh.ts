// When is a flight due for another (paid) FlightAware lookup? The re-check job runs every few
// minutes and asks this for every active ride with a flight number; only the flights that are due
// are looked up.
//
//   - Nothing before the first checkpoint (48 h before landing): flight data that early rarely
//     changes anything. The lookup when the passenger types the flight number is separate and
//     always runs.
//   - Once per checkpoint after that (48 h, 24 h, 6 h, 2 h before landing).
//   - From the scheduled departure on: every few minutes until the flight has landed. Scheduled,
//     not actual: a flight that leaves late is exactly the one to keep watching.
//   - Never once it has landed, and no longer once it is hours overdue.
//
// No Deno-touching imports, so this runs under a plain Node test.

export type FlightRefreshSchedule = {
  // Hours before landing at which the flight is looked up once.
  checkpointHours: readonly number[];
  // How often it is looked up from its scheduled departure until it has landed.
  inFlightMinutes: number;
  // Hours after the expected landing after which a flight that never reported landing is dropped.
  giveUpHours: number;
};

export type FlightCheckState = {
  // The ride's current expected landing.
  arrivalAtMs: number;
  lastCheckedAtMs: number | null;
  scheduledDepartureMs: number | null;
  landed: boolean;
};

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

// The job's ticks never land on the exact same second: without this a 10-minute interval checked
// by a 5-minute tick would keep missing by a moment and turn into 15.
const TICK_SLACK_MS = MINUTE_MS;

export function isFlightCheckDue(state: FlightCheckState, nowMs: number, schedule: FlightRefreshSchedule): boolean {
  if (state.landed) return false;
  if (schedule.checkpointHours.length === 0) return false;

  const firstCheckpointMs = state.arrivalAtMs - Math.max(...schedule.checkpointHours) * HOUR_MS;
  if (nowMs < firstCheckpointMs) return false;
  if (nowMs > state.arrivalAtMs + schedule.giveUpHours * HOUR_MS) return false;
  if (state.lastCheckedAtMs == null) return true;

  // Until the scheduled departure is known (it comes with the first lookup), the last checkpoint
  // stands in for it.
  const inFlightFromMs =
    state.scheduledDepartureMs ?? state.arrivalAtMs - Math.min(...schedule.checkpointHours) * HOUR_MS;
  if (nowMs >= inFlightFromMs) {
    return nowMs - state.lastCheckedAtMs >= schedule.inFlightMinutes * MINUTE_MS - TICK_SLACK_MS;
  }

  // Before departure: due when a checkpoint has passed since the last lookup.
  const latestCheckpointMs = Math.max(
    ...schedule.checkpointHours.map((hours) => state.arrivalAtMs - hours * HOUR_MS).filter((ms) => ms <= nowMs)
  );
  return state.lastCheckedAtMs < latestCheckpointMs;
}
