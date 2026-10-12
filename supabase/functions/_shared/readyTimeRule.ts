// Ready times in matching. A passenger is ready some time after their plane reaches the gate
// (the database calculates when - see 20261012050000_ready_time.sql); everything about a group's
// timing goes by that, not by the arrival:
//   - the group meets (and leaves) when its last member is ready;
//   - each member waits from their own ready time until then;
//   - a group is only valid if EVERY member's own wait fits their own maximum wait - never an
//     average.
//
// No Deno-touching imports, so this runs under a plain Node test. The app's copy is
// src/services/readyTimeRules.ts.

const MINUTE_MS = 60_000;

// A ride as far as its timing goes. ready_at is only missing on a ride read without it (or from
// before ready times existed); its arrival then stands in.
export type ReadyRide = { arrival_at: string; ready_at?: string | null };

export function readyIso(ride: ReadyRide): string {
  return ride.ready_at ?? ride.arrival_at;
}

export function readyMs(ride: ReadyRide): number {
  return new Date(readyIso(ride)).getTime();
}

// When the group meets: its latest ready time.
export function meetingTimeMs(rides: ReadyRide[]): number {
  return Math.max(...rides.map(readyMs));
}

export function waitMinutes(ride: ReadyRide, meetingMs: number): number {
  return Math.max(0, (meetingMs - readyMs(ride)) / MINUTE_MS);
}

export type WaitingRide = ReadyRide & { id: string; max_wait_minutes: number };

export type WaitOverLimit = { request_id: string; waiting_minutes: number; max_wait_minutes: number };

// The first member who would wait longer than their own maximum, or null when everyone's wait fits.
export function waitOverLimit(rides: WaitingRide[]): WaitOverLimit | null {
  const meetingMs = meetingTimeMs(rides);
  for (const ride of rides) {
    const waiting = waitMinutes(ride, meetingMs);
    if (waiting > ride.max_wait_minutes) {
      return { request_id: ride.id, waiting_minutes: waiting, max_wait_minutes: ride.max_wait_minutes };
    }
  }
  return null;
}

export function waitsFit(rides: WaitingRide[]): boolean {
  return waitOverLimit(rides) === null;
}
