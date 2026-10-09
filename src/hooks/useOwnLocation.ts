import type { LocationSubscription } from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getLocationAccess, LocationAccess, requestLocationAccess, watchOwnPosition } from '../services/locationSharing';
import { Fix } from '../services/locationSharingRules';

// The passenger's own position for the screen that mounts this - for the arrow to the meeting
// point. It stays on the phone: nothing here sends it anywhere (sharing with the group is a
// separate opt-in, see useLocationSharing).
//
// Starts by itself when the app may already use the location; it never shows the system prompt on
// its own - only request() does, after the passenger asked for directions. Reads the position
// only while `enabled` and the app is in the foreground.
export function useOwnLocation(enabled: boolean) {
  const [access, setAccess] = useState<LocationAccess | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [fix, setFix] = useState<Fix | null>(null);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  // Checked again on every return to the app: the permission may have been changed in Settings.
  useEffect(() => {
    if (!appActive) return;
    let cancelled = false;
    getLocationAccess()
      .then((current) => {
        if (!cancelled) setAccess(current);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appActive]);

  useEffect(() => {
    if (!enabled || !appActive || access !== 'granted') return;
    let cancelled = false;
    let subscription: LocationSubscription | null = null;
    watchOwnPosition(setFix)
      .then((started) => {
        if (cancelled) started.remove();
        else subscription = started;
      })
      .catch(() => {
        if (!cancelled) setAccess('unavailable');
      });
    return () => {
      cancelled = true;
      subscription?.remove();
      setFix(null);
    };
  }, [enabled, appActive, access]);

  // Shows the system prompt if it hasn't been answered yet. Returns what was granted.
  const request = useCallback(async () => {
    const granted = await requestLocationAccess();
    setAccess(granted);
    return granted;
  }, []);

  return { access, fix, request };
}
