// When has a passenger landed? At their flight's latest estimated landing (which becomes the
// actual one once flight data reports it), or - without flight data - at the ride's own arrival
// time. Not at the moment flight data says "landed": that report can come half an hour late.
//
// No Deno-touching imports, so this runs under a plain Node test. The app's copy is
// src/services/findGroupEntryRules.ts.

export type LandingTimes = {
  arrival_at: string;
  flight_estimated_arrival_at: string | null;
};

export function expectedLandingIso(ride: LandingTimes): string {
  return ride.flight_estimated_arrival_at ?? ride.arrival_at;
}

// The "You've landed" notification: once per ride, from the expected landing on - but no longer
// once it is `maxLateMinutes` overdue (the job was down, or the ride joined its group afterwards).
export function landedPushDue(
  ride: LandingTimes & { landed_push_sent_at: string | null },
  nowMs: number,
  maxLateMinutes: number
): boolean {
  if (ride.landed_push_sent_at != null) return false;
  const landingMs = new Date(expectedLandingIso(ride)).getTime();
  return nowMs >= landingMs && nowMs - landingMs <= maxLateMinutes * 60_000;
}
