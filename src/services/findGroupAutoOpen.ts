import AsyncStorage from '@react-native-async-storage/async-storage';

import { fetchMeetup } from './findGroup';
import { shouldAutoOpen } from './findGroupEntryRules';
import { fetchMyActiveRequest } from './passengerRequests';

// Remembered per ride, on this phone only: the app already took the passenger straight to "Find
// your group" once.
const autoOpenedKey = (requestId: string) => `findGroup.autoOpened.${requestId}`;

// Whether opening the app should go straight to "Find your group": the passenger has a confirmed
// group, has landed, and wasn't taken there before (findGroupEntryRules.ts). Answers "yes" at most
// once per ride. Any failure is a "no": the app then simply opens as usual.
export async function shouldOpenFindGroupNow(): Promise<boolean> {
  try {
    const { data: active } = await fetchMyActiveRequest();
    if (!active || active.group_status !== 'confirmed') return false;

    const key = autoOpenedKey(active.id);
    if ((await AsyncStorage.getItem(key)) === 'yes') return false;

    const { meetup } = await fetchMeetup(active.id);
    if (!shouldAutoOpen(meetup, Date.now(), false)) return false;

    await AsyncStorage.setItem(key, 'yes');
    return true;
  } catch {
    return false;
  }
}
