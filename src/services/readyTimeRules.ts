// Ready times in matching, on the app's side (the server's copy, with the tests, is
// supabase/functions/_shared/readyTimeRule.ts - keep the two in sync). A passenger is ready some
// time after their plane reaches the gate (the database calculates when); everything about a
// group's timing goes by that, not by the arrival:
//   - the group meets (and leaves) when its last member is ready;
//   - each member waits from their own ready time until then;
//   - a group is only valid if EVERY member's own wait fits their own maximum wait.
//
// No imports, so this runs under a plain Node test.

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

export function waitsFit(rides: WaitingRide[]): boolean {
  const meetingMs = meetingTimeMs(rides);
  return rides.every((ride) => waitMinutes(ride, meetingMs) <= ride.max_wait_minutes);
}

// Calibration: one kind of ride (flight category and checked bag) with how far its passengers'
// real arrival at the meeting point was from their calculated ready time, on average.
export type CalibrationRow = {
  category: 'schengen' | 'non_schengen' | 'unknown' | 'no_flight';
  checked_bag: boolean;
  rides: number;
  buffer_minutes: number;
  // Positive: they reached the meeting point later than calculated.
  average_difference_minutes: number;
};

// What an average difference means for the buffer: passengers come later than calculated (the
// buffer is too short), earlier (too long), or within a minute of it.
export function calibrationVerdict(averageDifferenceMinutes: number): 'later' | 'earlier' | 'onTime' {
  if (Math.abs(averageDifferenceMinutes) < 1) return 'onTime';
  return averageDifferenceMinutes > 0 ? 'later' : 'earlier';
}

// A member of a confirmed group whose flight now arrives well off the time the group was formed
// on: the difference in minutes when it is `flagMinutes` or more, otherwise null. (The group is
// never changed automatically - the admin is shown this.)
export function flightTimeChange(
  ride: { arrival_at: string; flight_estimated_arrival_at?: string | null },
  flagMinutes: number
): { minutes: number; estimatedAt: string } | null {
  if (!ride.flight_estimated_arrival_at) return null;
  const minutes = (new Date(ride.flight_estimated_arrival_at).getTime() - new Date(ride.arrival_at).getTime()) / MINUTE_MS;
  return Math.abs(minutes) >= flagMinutes ? { minutes: Math.round(minutes), estimatedAt: ride.flight_estimated_arrival_at } : null;
}
