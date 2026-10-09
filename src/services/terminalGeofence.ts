import * as Location from 'expo-location';

import { TERMINAL_GEOFENCE_METERS } from '../constants';
import { supabase } from './supabase';
import { ArrivalTerminal, terminalNear, TerminalLandmark } from './terminalRules';

// How old a remembered position may be to still say where the passenger is standing.
const MAX_POSITION_AGE_MS = 120_000;
// Too rough a fix says "at the airport" at best, not which terminal.
const MAX_POSITION_ACCURACY_METERS = 200;

// The terminal the passenger is standing in right now, to prefill the request form - or null.
//   - Only if the app may already use the location: this never shows a permission prompt.
//   - The landmarks are the meeting points an admin verified on site, so there is nothing to
//     guess: a terminal without a verified point simply gets no prefill.
//   - The position is read once and compared on the phone. It is not sent anywhere or stored.
export async function detectTerminalFromLocation(): Promise<ArrivalTerminal | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;

    const { data: landmarks } = await supabase
      .from('meeting_points')
      .select('terminal, latitude, longitude')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .not('verified_at', 'is', null)
      .returns<TerminalLandmark[]>();
    if (!landmarks?.length) return null;

    const position =
      (await Location.getLastKnownPositionAsync({
        maxAge: MAX_POSITION_AGE_MS,
        requiredAccuracy: MAX_POSITION_ACCURACY_METERS,
      })) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (!position || (position.coords.accuracy ?? Infinity) > MAX_POSITION_ACCURACY_METERS) return null;

    return terminalNear(position.coords, landmarks, TERMINAL_GEOFENCE_METERS);
  } catch {
    return null;
  }
}
