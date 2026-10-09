import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Guidance } from '../hooks/useGuidance';
import { MeetingPointSummary, meetingPointText, wordingLanguageFor } from '../services/meetingPointRules';
import { meetingPointPhotoUrl, shippedText } from '../services/meetingPoints';
import { baseText, colors, radii, spacing } from '../theme/colors';
import GuidanceArrow from './GuidanceArrow';
import SecondaryButton from './SecondaryButton';

type Props = {
  point: MeetingPointSummary;
  // Null while the phone has no position yet.
  guidance: Guidance | null;
  // The passenger is marked as at the meeting point (their own tap, or detected).
  arrived: boolean;
  onShowBadge: () => void;
};

// Which of the panel's faces is showing - also what the screen needs to know to not repeat the
// photo in the card underneath.
export type GuidanceFace = 'locating' | 'arrow' | 'close' | 'almostThere' | 'arrived';

export function guidanceFace(guidance: Guidance | null, arrived: boolean): GuidanceFace {
  if (arrived) return 'arrived';
  if (!guidance) return 'locating';
  if (guidance.inZone) return 'almostThere';
  return guidance.display.kind === 'close' ? 'close' : 'arrow';
}

export const guidanceShowsPhoto = (face: GuidanceFace) => face === 'close' || face === 'almostThere' || face === 'arrived';

// The way to the meeting point, from the passenger's own position (which never leaves the phone):
//   - far away: an arrow and the distance;
//   - close, or wherever the GPS is too rough to trust an arrow: the meeting point's photo and
//     its written directions - never just a text with nothing to go on;
//   - nearly there and there: the photo and the group's badge.
export default function GuidancePanel({ point, guidance, arrived, onShowBadge }: Props) {
  const { t, i18n } = useTranslation();
  const language = wordingLanguageFor(i18n.language);
  const name = meetingPointText(point, 'name', language, shippedText);
  const directions = meetingPointText(point, 'directions', language, shippedText);
  const face = guidanceFace(guidance, arrived);

  const photo = point.photo_path ? (
    <Image
      source={{ uri: meetingPointPhotoUrl(point.photo_path) }}
      style={styles.photo}
      resizeMode="cover"
      accessibilityLabel={t('meetingPointCard.photoLabel', { name })}
    />
  ) : null;

  const badgeButton = <SecondaryButton label={t('badge.showButton')} icon="shapes-outline" onPress={onShowBadge} />;

  if (face === 'arrived' || face === 'almostThere') {
    return (
      <View style={styles.panel}>
        <Text style={styles.heading}>{t(face === 'arrived' ? 'guidance.arrivedTitle' : 'guidance.almostThere')}</Text>
        <Text style={styles.target}>{name}</Text>
        {photo}
        {badgeButton}
      </View>
    );
  }

  if (face === 'close') {
    return (
      <View style={styles.panel}>
        <Text style={styles.heading}>{t('guidance.closeHeading')}</Text>
        <Text style={styles.target}>{name}</Text>
        {photo}
        {directions ? <Text style={styles.directions}>{directions}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.target}>{t('guidance.targetLine', { name })}</Text>
      {face === 'locating' || !guidance ? (
        <Text style={styles.locating}>{t('guidance.locating')}</Text>
      ) : (
        <>
          <View style={styles.arrowStage}>
            <GuidanceArrow bearing={guidance.bearing} />
          </View>
          {guidance.display.kind === 'exact' ? (
            <Text style={styles.distance}>{t('guidance.distanceAway', { meters: guidance.display.meters })}</Text>
          ) : guidance.display.kind === 'approx' ? (
            <Text style={styles.distance}>{t('guidance.distanceApprox', { meters: guidance.display.meters })}</Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginBottom: spacing.x6,
  },
  heading: {
    ...baseText.h2,
    textAlign: 'center',
    marginBottom: spacing.x2,
  },
  target: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  arrowStage: {
    alignItems: 'center',
    marginBottom: spacing.x4,
  },
  distance: {
    ...baseText.h1,
    textAlign: 'center',
  },
  locating: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: spacing.x8,
  },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceCardSolid,
    marginBottom: spacing.x4,
  },
  directions: {
    ...baseText.body,
    textAlign: 'center',
  },
});
