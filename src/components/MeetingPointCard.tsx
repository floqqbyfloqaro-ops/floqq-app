import { useTranslation } from 'react-i18next';
import { Image, Linking, StyleSheet, Text } from 'react-native';

import { MeetingPointSummary, meetingPointText, wordingLanguageFor } from '../services/meetingPointRules';
import { meetingPointPhotoUrl, shippedText } from '../services/meetingPoints';
import { baseText, colors, radii, spacing } from '../theme/colors';
import { barcelonaDateParts } from '../utils/formatDateTime';
import Card from './Card';
import SecondaryButton from './SecondaryButton';

type Props = {
  // The group's arrival terminal ('T1' / 'T2'), shown even before a point is assigned: T1 and T2
  // are kilometres apart, so which terminal is the first thing a passenger must know.
  terminal: string | null;
  // Null until the group has been given its meeting point.
  point: MeetingPointSummary | null;
  meetingTime: string | null;
};

// "T1" -> "1", "T2B" -> "2B": the part that follows the word "Terminal".
const terminalNumber = (terminal: string) => terminal.replace(/^T/, '');

// Where a confirmed group meets at the airport: the terminal, the landmark with its photo, how to
// walk there from the baggage claim exit, and when. The wording is the passenger's own language
// (the admin's edits where there are any, otherwise what ships with the app).
export default function MeetingPointCard({ terminal, point, meetingTime }: Props) {
  const { t, i18n } = useTranslation();
  const language = wordingLanguageFor(i18n.language);

  // The point's own terminal is the more exact one (a T2 group meets in T2B).
  const shownTerminal = point?.terminal ?? terminal;
  const name = point ? meetingPointText(point, 'name', language, shippedText) : null;
  const directions = point ? meetingPointText(point, 'directions', language, shippedText) : null;
  const hasCoordinates = point?.latitude != null && point.longitude != null;

  const openInMaps = () => {
    if (!point || point.latitude == null || point.longitude == null) return;
    // Google's universal link: opens the Google Maps app when installed, otherwise the browser.
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`);
  };

  let meetingTimeLabel: string | null = null;
  if (meetingTime) {
    const { hour, minute } = barcelonaDateParts(meetingTime);
    meetingTimeLabel = t('meetingPointCard.meetingTime', { time: `${hour}:${minute}` });
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.label}>{t('meetingPointCard.title')}</Text>
      {shownTerminal ? (
        <Text style={styles.terminal}>{t('meetingPointCard.terminal', { terminal: terminalNumber(shownTerminal) })}</Text>
      ) : null}

      {point ? (
        <>
          {point.photo_path ? (
            <Image
              source={{ uri: meetingPointPhotoUrl(point.photo_path) }}
              style={styles.photo}
              resizeMode="cover"
              accessibilityLabel={t('meetingPointCard.photoLabel', { name })}
            />
          ) : null}
          <Text style={styles.name}>{name}</Text>
          {directions ? <Text style={styles.directions}>{directions}</Text> : null}
        </>
      ) : (
        <Text style={styles.directions}>{t('meetingPointCard.pending')}</Text>
      )}

      {meetingTimeLabel ? <Text style={styles.meetingTime}>{meetingTimeLabel}</Text> : null}

      {hasCoordinates ? (
        <SecondaryButton label={t('meetingPointCard.openInMaps')} icon="map-outline" onPress={openInMaps} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.x4,
  },
  label: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  terminal: {
    ...baseText.h1,
    marginBottom: spacing.x3,
  },
  photo: {
    width: '100%',
    height: 180,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceCardSolid,
    marginBottom: spacing.x3,
  },
  name: {
    ...baseText.h3,
    marginBottom: spacing.x1,
  },
  directions: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x3,
  },
  meetingTime: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x3,
  },
});
