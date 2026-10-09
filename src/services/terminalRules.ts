import { distanceMeters } from './locationSharingRules';

// The same-terminal rule on the app's side (the server's copy is
// supabase/functions/_shared/terminalRule.ts): a taxi group only holds passengers arriving at the
// same terminal. T2A, T2B and T2C are one terminal here (T2).

export type ArrivalTerminal = 'T1' | 'T2';
export type ArrivalTerminalSource = 'flight' | 'passenger';

export const ARRIVAL_TERMINALS: ArrivalTerminal[] = ['T1', 'T2'];

// Two passengers may share a group only when both terminals are known and equal.
export function sameTerminal(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && a === b;
}

// A meeting point's terminal ('T1', 'T2A', 'T2B', 'T2C') as a ride's terminal.
export function terminalOfMeetingPoint(pointTerminal: string): ArrivalTerminal | null {
  if (pointTerminal === 'T1') return 'T1';
  if (pointTerminal.startsWith('T2')) return 'T2';
  return null;
}

export type TerminalLandmark = { terminal: string; latitude: number; longitude: number };

// Which terminal someone standing at `position` is in: the terminal of the nearest known landmark,
// if it is within `radiusMeters`. Null when they aren't near any (not at the airport, or at a
// terminal without a landmark yet).
export function terminalNear(
  position: { latitude: number; longitude: number },
  landmarks: TerminalLandmark[],
  radiusMeters: number
): ArrivalTerminal | null {
  let nearest: { terminal: string; meters: number } | null = null;
  for (const landmark of landmarks) {
    const meters = distanceMeters(
      { lat: position.latitude, lng: position.longitude },
      { lat: landmark.latitude, lng: landmark.longitude }
    );
    if (!nearest || meters < nearest.meters) nearest = { terminal: landmark.terminal, meters };
  }
  if (!nearest || nearest.meters > radiusMeters) return null;
  return terminalOfMeetingPoint(nearest.terminal);
}
