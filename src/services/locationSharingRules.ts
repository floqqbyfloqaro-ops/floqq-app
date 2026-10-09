// The pure rules behind "Find your group" location sharing - no React Native imports, so they can
// be unit tested with plain Node.

import { distanceMeters } from './guidanceRules';

export type Fix = {
  lat: number;
  lng: number;
  // Reported accuracy radius in meters; null when the device didn't give one.
  accuracy: number | null;
  // When the device measured it (ms since epoch).
  at: number;
};

export { distanceMeters };

export type SendRule = { intervalMs: number; distanceMeters: number };

// A position goes out when enough time has passed or the member moved far enough since the last
// one sent, whichever comes first. `now` is the clock, not the fix's own time: a member standing
// still keeps getting the same fix, and it is still re-sent once per interval.
export function shouldSendPosition(lastSent: Fix | null, lastSentAt: number, next: Fix, now: number, rule: SendRule): boolean {
  if (!lastSent) return true;
  if (now - lastSentAt >= rule.intervalMs) return true;
  return distanceMeters(lastSent, next) >= rule.distanceMeters;
}

export type MemberSharingStatus =
  | { kind: 'sharing' }
  // Was sharing earlier; minutes since their last position reached this phone.
  | { kind: 'lastSeen'; minutesAgo: number }
  | { kind: 'notSharing' };

export function memberSharingStatus(isSharingNow: boolean, lastReceivedAt: number | null, now: number): MemberSharingStatus {
  if (isSharingNow) return { kind: 'sharing' };
  if (lastReceivedAt == null) return { kind: 'notSharing' };
  return { kind: 'lastSeen', minutesAgo: Math.max(0, Math.floor((now - lastReceivedAt) / 60_000)) };
}
