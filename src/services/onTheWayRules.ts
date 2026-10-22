// The pure rules behind the "On the way" screen - no imports, so a plain Node test loads this file
// directly (onTheWayRules.test.mjs).

// How long after the start a ride counts as in progress at most. FLOQQ doesn't follow the taxi, so
// the taxi receipt is the only sign that it arrived; without one, after this, My Ride shows the
// ride's normal card again.
export const ON_THE_WAY_HOURS = 3;

const HOUR_MS = 60 * 60 * 1000;

export type RideProgress = {
  groupStatus: 'unconfirmed' | 'confirmed' | 'dissolved' | null;
  // When the group's ride started ("We're in the taxi", or automatically); null before that.
  rideStartedAt: string | null;
  // When the group's taxi receipt came in; null while there is none (or it was rejected).
  receiptReceivedAt?: string | null;
};

// In progress: a confirmed group whose ride started less than ON_THE_WAY_HOURS ago and whose taxi
// receipt isn't in yet. Never before the start (a confirmed ride still waiting at the airport),
// never after (a completed ride).
export function rideInProgress(ride: RideProgress, nowMs: number, hours: number = ON_THE_WAY_HOURS): boolean {
  if (ride.groupStatus !== 'confirmed' || !ride.rideStartedAt || ride.receiptReceivedAt) return false;
  const startedMs = new Date(ride.rideStartedAt).getTime();
  return nowMs >= startedMs && nowMs < startedMs + hours * HOUR_MS;
}

// The info card's text: "secured" only when payments are on - with them off nothing is secured.
export function shareInfoKey(paymentsEnabled: boolean): 'share_secured_info' | 'share_calculated_info' {
  return paymentsEnabled ? 'share_secured_info' : 'share_calculated_info';
}
