import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GuidanceState } from '../services/guidanceRules';
import type { LocationAccess } from '../services/locationSharing';
import type { Fix } from '../services/locationSharingRules';
import { MeetingPointSummary } from '../services/meetingPointRules';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  state: GuidanceState;
  // Whether the screen may use the location at all yet (not before landing).
  locationAllowed: boolean;
  access: LocationAccess | null;
  fix: Fix | null;
  headingReliable: boolean | null;
  point: MeetingPointSummary | null;
  // Metres to the meeting point; null without a position or a point.
  distance: number | null;
};

// How often the live compass value is redrawn while the panel is open.
const HEADING_REDRAW_MS = 250;

// "Find your group" diagnostics: what the guidance is working from, for testing at home and at the
// airport. Development builds only - the screen never mounts it in a store build (__DEV__) - so
// its wording is English only. Reads nothing that leaves the phone; the compass is only watched
// while the panel is open.
export default function GuidanceDiagnostics({
  state,
  locationAllowed,
  access,
  fix,
  headingReliable,
  point,
  distance,
}: Props) {
  const [open, setOpen] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [headingAccuracy, setHeadingAccuracy] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastRedraw = useRef(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    Location.watchHeadingAsync((reading) => {
      const at = Date.now();
      if (at - lastRedraw.current < HEADING_REDRAW_MS) return;
      lastRedraw.current = at;
      const raw = reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
      setHeading(raw >= 0 ? raw : null);
      setHeadingAccuracy(reading.accuracy);
    })
      .then((started) => {
        if (cancelled) started.remove();
        else subscription = started;
      })
      .catch(() => {
        if (!cancelled) setHeading(null);
      });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      subscription?.remove();
      clearInterval(clock);
    };
  }, [open]);

  const rows: [string, string][] = [
    ['Guidance state', state],
    ['Location used', locationAllowed ? 'yes' : 'no (not landed yet)'],
    ['Permission', access ?? 'checking…'],
    [
      'Last position',
      fix
        ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} · ${Math.round((now - fix.at) / 1000)} s ago`
        : 'none yet',
    ],
    ['Accuracy', fix?.accuracy != null ? `±${Math.round(fix.accuracy)} m` : 'unknown'],
    [
      'Compass',
      `${headingReliable == null ? 'no reading yet' : headingReliable ? 'usable' : 'not usable'}${
        open && heading != null ? ` · ${Math.round(heading)}°` : ''
      }${open && headingAccuracy != null ? ` (accuracy ${headingAccuracy})` : ''}`,
    ],
    [
      'Target',
      point
        ? `${point.short_code} (${point.kind})${
            point.latitude != null && point.longitude != null
              ? ` · ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`
              : ' · no coordinates'
          }`
        : 'none',
    ],
    ['Distance', distance != null ? `${Math.round(distance)} m` : '—'],
  ];

  return (
    <View style={styles.panel}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.header}
      >
        <Ionicons name="bug-outline" size={16} color={colors.textSecondary} />
        <Text style={styles.headerText}>Diagnostics (development build)</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </Pressable>
      {open
        ? rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value} selectable>
                {value}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginBottom: spacing.x4,
    padding: spacing.x3,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    borderStyle: 'dashed',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  headerText: {
    ...baseText.caption,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.x3,
    marginTop: spacing.x2,
  },
  label: {
    ...baseText.caption,
    width: 110,
  },
  value: {
    ...baseText.caption,
    color: colors.textPrimary,
    flex: 1,
  },
});
