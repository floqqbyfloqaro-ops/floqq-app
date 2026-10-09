import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';

import { GUIDANCE } from '../constants';
import {
  bearingDegrees,
  DistanceDisplay,
  distanceDisplay,
  distanceMeters,
  hasArrived,
  LatLng,
  nextArrivalStreak,
  nextZoneState,
} from '../services/guidanceRules';
import { Fix } from '../services/locationSharingRules';

export type Guidance = {
  // Where the meeting point lies from here: 0 = north, 90 = east.
  bearing: number;
  // What to show for the distance - or that the fix is too rough this close to show an arrow.
  display: DistanceDisplay;
  // Within the "almost there" zone around the meeting point.
  inZone: boolean;
};

type Options = {
  // The phone's own position; null while there is none.
  fix: Fix | null;
  // The meeting point; null when the group has none (or it has no coordinates yet).
  target: LatLng | null;
  // Whether the phone may mark the passenger as arrived by itself, and what to do when it does.
  autoArrival: boolean;
  onAutoArrive: () => void;
};

// Turns the phone's own position into guidance to the meeting point (guidanceRules.ts holds the
// rules). All of it happens on the phone: nothing here sends a position anywhere.
export function useGuidance({ fix, target, autoArrival, onAutoArrive }: Options): Guidance | null {
  const [inZone, setInZone] = useState(false);
  const inZoneRef = useRef(false);
  const arrivalStreak = useRef(0);
  const lastFixAt = useRef<number | null>(null);
  const onAutoArriveRef = useRef(onAutoArrive);
  onAutoArriveRef.current = onAutoArrive;

  const targetLat = target?.lat;
  const targetLng = target?.lng;

  // Another meeting point: what was true around the old one no longer is.
  useEffect(() => {
    inZoneRef.current = false;
    setInZone(false);
    arrivalStreak.current = 0;
  }, [targetLat, targetLng]);

  useEffect(() => {
    if (!fix || targetLat == null || targetLng == null) return;
    // Each reading counts once, however often the screen re-renders.
    if (lastFixAt.current === fix.at) return;
    lastFixAt.current = fix.at;

    const distance = distanceMeters(fix, { lat: targetLat, lng: targetLng });

    const wasInZone = inZoneRef.current;
    const nowInZone = nextZoneState(wasInZone, distance, fix.accuracy, GUIDANCE);
    if (nowInZone !== wasInZone) {
      inZoneRef.current = nowInZone;
      setInZone(nowInZone);
      // A light tap on the way in: "look up, you're nearly there".
      if (nowInZone) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    arrivalStreak.current = nextArrivalStreak(arrivalStreak.current, distance, fix.accuracy, GUIDANCE);
    if (autoArrival && hasArrived(arrivalStreak.current, GUIDANCE)) {
      arrivalStreak.current = 0;
      onAutoArriveRef.current();
    }
  }, [fix, targetLat, targetLng, autoArrival]);

  if (!fix || targetLat == null || targetLng == null) return null;

  const destination = { lat: targetLat, lng: targetLng };
  const distance = distanceMeters(fix, destination);
  return {
    bearing: bearingDegrees(fix, destination),
    display: distanceDisplay(distance, fix.accuracy, GUIDANCE),
    inZone,
  };
}
