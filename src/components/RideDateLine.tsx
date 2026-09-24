import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import type { ArrivalTimeSource } from '../services/passengerRequests';
import { baseText, colors, spacing } from '../theme/colors';
import { barcelonaDateParts, barcelonaWeekday } from '../utils/formatDateTime';

// Admin-only. "Thu 25/09/2026 - 14:35", always in Barcelona time (see formatDateTime.ts).
export function formatRideDateTime(t: TFunction, language: string, iso: string): string {
  const { year, month, day, hour, minute } = barcelonaDateParts(iso);
  return t('admin.rideDateTime', {
    weekday: barcelonaWeekday(iso, language),
    date: `${day}/${month}/${year}`,
    time: `${hour}:${minute}`,
  });
}

// Admin-only. "Requested 24/09 at 18:12", in Barcelona time.
export function formatRequestedAt(t: TFunction, iso: string): string {
  const { month, day, hour, minute } = barcelonaDateParts(iso);
  return t('admin.requestedAt', { date: `${day}/${month}`, time: `${hour}:${minute}` });
}

// Plain-text version of what RideDateLine renders, for the parent card's accessibilityLabel.
export function rideDateAccessibilityText(
  t: TFunction,
  language: string,
  { arrivalAt, flightNumber, arrivalTimeSource, createdAt }: Props
): string {
  return [
    formatRideDateTime(t, language, arrivalAt),
    flightNumber,
    arrivalTimeSource === 'flight' ? t('admin.arrivalFromFlight') : null,
    createdAt ? formatRequestedAt(t, createdAt) : null,
  ]
    .filter(Boolean)
    .join(', ');
}

type Props = {
  arrivalAt: string;
  flightNumber?: string;
  arrivalTimeSource?: ArrivalTimeSource | null;
  createdAt?: string;
};

// The ride date/time as the main line of an admin request/member card, with the flight number and
// a plane icon when the time came from flight data, and the request's creation time underneath
// as secondary info. Accessibility text comes from rideDateAccessibilityText on the parent card.
export default function RideDateLine({ arrivalAt, flightNumber, arrivalTimeSource, createdAt }: Props) {
  const { t, i18n } = useTranslation();

  return (
    <View style={styles.container}>
      <View style={styles.mainRow}>
        <Text style={styles.rideDate}>{formatRideDateTime(t, i18n.language, arrivalAt)}</Text>
        {flightNumber ? <Text style={styles.flightNumber}>{flightNumber}</Text> : null}
        {arrivalTimeSource === 'flight' ? (
          <Ionicons
            name="airplane"
            size={14}
            color={colors.info}
            accessibilityLabel={t('admin.arrivalFromFlight')}
          />
        ) : null}
      </View>
      {createdAt ? <Text style={styles.requestedAt}>{formatRequestedAt(t, createdAt)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.x1,
  },
  mainRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.x2,
  },
  rideDate: {
    ...baseText.body,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  flightNumber: {
    ...baseText.bodySmall,
    fontWeight: '600',
    color: colors.accentPrimaryStrong,
  },
  requestedAt: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: spacing.x1,
  },
});
