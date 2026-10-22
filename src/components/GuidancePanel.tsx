import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { GUIDANCE } from '../constants';
import type { Guidance } from '../hooks/useGuidance';
import { distanceText, GuidanceState } from '../services/guidanceRules';
import type { LocationAccess } from '../services/locationSharing';
import { MeetingPointSummary, meetingPointText, wordingLanguageFor } from '../services/meetingPointRules';
import { meetingPointPhotoUrl, shippedText } from '../services/meetingPoints';
import { baseText, colors, radii, spacing } from '../theme/colors';
import GuidanceArrow from './GuidanceArrow';
import SecondaryButton from './SecondaryButton';

type Props = {
  state: GuidanceState;
  // Null only while the state is 'loadingPoint' (or a preview of a group without one).
  point: MeetingPointSummary | null;
  // Null while the phone has no position yet.
  guidance: Guidance | null;
  // The permission, for the 'permission' state's wording and button.
  access: LocationAccess | null;
  onAllowLocation: () => void;
  onOpenSettings: () => void;
  onShowBadge: () => void;
  onHeadingReliability: (reliable: boolean) => void;
};

// The guidance area at the top of "Find your group": the way to the meeting point from the
// passenger's own position (which never leaves the phone), or - whenever that isn't possible yet -
// what is in the way and what to do about it. Always says something (guidanceRules.ts decides
// which state applies):
//   - far away and on the way: an arrow and the distance (kilometres when far);
//   - close, or wherever the GPS is too rough to trust an arrow: the meeting point's photo and
//     its written directions - never just a text with nothing to go on;
//   - nearly there and there: the photo and the group's badge.
export default function GuidancePanel({
  state,
  point,
  guidance,
  access,
  onAllowLocation,
  onOpenSettings,
  onShowBadge,
  onHeadingReliability,
}: Props) {
  const { t, i18n } = useTranslation();
  const language = wordingLanguageFor(i18n.language);
  const name = point ? meetingPointText(point, 'name', language, shippedText) : '';
  const directions = point ? meetingPointText(point, 'directions', language, shippedText) : '';
  const targetLine = name ? <Text style={styles.target}>{t('guidance.targetLine', { name })}</Text> : null;

  const photo = point?.photo_path ? (
    <Image
      source={{ uri: meetingPointPhotoUrl(point.photo_path) }}
      style={styles.photo}
      resizeMode="cover"
      accessibilityLabel={t('meetingPointCard.photoLabel', { name })}
    />
  ) : null;

  const message = (icon: keyof typeof Ionicons.glyphMap, text: string) => (
    <View style={styles.message}>
      <Ionicons name={icon} size={40} color={colors.textSecondary} />
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );

  const loader = (text: string) => (
    <View style={styles.message} accessible accessibilityLabel={text}>
      <ActivityIndicator color={colors.accentPrimaryStrong} />
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );

  switch (state) {
    case 'preview':
      return (
        <View style={styles.panel}>
          {targetLine}
          {message('airplane-outline', t('guidance_starts_on_landing'))}
        </View>
      );

    case 'loadingPoint':
      return <View style={styles.panel}>{loader(t('meetingPointCard.loading'))}</View>;

    case 'permission': {
      // Asking is only possible while the system prompt was never answered; after that the
      // setting is changed in the phone's settings.
      const canAsk = access === 'undetermined';
      const reason =
        access === 'reduced'
          ? t('guidance.permissionReduced')
          : access === 'unavailable'
            ? t('guidance.permissionUnavailable')
            : access === 'denied'
              ? t('guidance.permissionDenied')
              : t('guidance.permissionNote');
      return (
        <View style={styles.panel}>
          {targetLine}
          {message('navigate-outline', t('guidance.permissionTitle'))}
          <Text style={styles.note}>{reason}</Text>
          {canAsk ? (
            <SecondaryButton label={t('guidance.allowLocation')} icon="navigate-outline" onPress={onAllowLocation} />
          ) : access !== 'unavailable' ? (
            <SecondaryButton label={t('findGroup.openSettings')} icon="settings-outline" onPress={onOpenSettings} />
          ) : null}
        </View>
      );
    }

    case 'locating':
      return (
        <View style={styles.panel}>
          {targetLine}
          {loader(t('guidance.locating'))}
        </View>
      );

    case 'arrived':
    case 'almostThere':
      return (
        <View style={styles.panel}>
          <Text style={styles.heading}>{t(state === 'arrived' ? 'guidance.arrivedTitle' : 'guidance.almostThere')}</Text>
          {name ? <Text style={styles.target}>{name}</Text> : null}
          {photo}
          <SecondaryButton label={t('badge.showButton')} icon="shapes-outline" onPress={onShowBadge} />
        </View>
      );

    case 'close':
      return (
        <View style={styles.panel}>
          <Text style={styles.heading}>{t('guidance.closeHeading')}</Text>
          {name ? <Text style={styles.target}>{name}</Text> : null}
          {photo}
          {directions ? <Text style={styles.directions}>{directions}</Text> : null}
        </View>
      );

    case 'far':
    case 'arrow':
    case 'compass': {
      if (!guidance) return <View style={styles.panel}>{loader(t('guidance.locating'))}</View>;
      // Also when the compass needs calibrating: the passenger is just as far away.
      const isFar = guidance.distance > GUIDANCE.farMeters;
      const shown = distanceText(guidance.distance);
      const value = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(shown.value);
      // "Approx." whenever the fix is rough, whatever the distance.
      const approx = guidance.display.kind !== 'exact';
      const distanceLabel =
        shown.unit === 'km'
          ? t(approx ? 'guidance.distanceApproxKm' : 'guidance.distanceAwayKm', { km: value })
          : t(approx ? 'guidance.distanceApprox' : 'guidance.distanceAway', { meters: value });
      return (
        <View style={styles.panel}>
          {targetLine}
          {/* Stays mounted in the compass state too: it keeps listening, and shows the arrow
              again as soon as the compass can be trusted. */}
          <View style={styles.arrowStage}>
            <GuidanceArrow bearing={guidance.bearing} onReliabilityChange={onHeadingReliability} />
          </View>
          <Text style={styles.distance}>{distanceLabel}</Text>
          {isFar ? (
            <Text style={styles.note}>{t('guidance.notAtAirport')}</Text>
          ) : null}
        </View>
      );
    }
  }
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
  message: {
    alignItems: 'center',
    gap: spacing.x3,
    marginVertical: spacing.x4,
  },
  messageText: {
    ...baseText.body,
    textAlign: 'center',
  },
  note: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.x2,
    marginBottom: spacing.x4,
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
