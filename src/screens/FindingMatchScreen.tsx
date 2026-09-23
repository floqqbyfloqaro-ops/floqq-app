import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import { cancelPassengerRequest, MyPassengerRequest } from '../services/passengerRequests';
import { baseText, borders, colors, elevation, motion, overlays, radii, spacing } from '../theme/colors';
import { easingStandard } from '../utils/animation';

type Props = {
  request: MyPassengerRequest;
  onBack: () => void;
  onEdit: () => void;
  onCancelled: () => void;
};

// No real per-passenger candidate data is reachable from the client today: the corridor-match
// DB function isn't security-definer, so RLS limits a passenger's query to their own row, and
// there's no avatar/photo concept anywhere in this app's schema. These are generic placeholders,
// not a claim that this many travelers have actually been found.
const PLACEHOLDER_AVATARS = [
  require('../../assets/avatars/avatar-1.png'),
  require('../../assets/avatars/avatar-2.png'),
  require('../../assets/avatars/avatar-3.png'),
];

export default function FindingMatchScreen({ request, onBack, onEdit, onCancelled }: Props) {
  const { t } = useTranslation();
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: motion.durationSlow * 4,
        easing: easingStandard,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: motion.durationSlow,
          easing: easingStandard,
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: motion.durationSlow,
          easing: easingStandard,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  const ringStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0.15, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
  };

  const breatheStyle = {
    transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }) }],
  };

  const handleCancelPress = () => {
    Alert.alert(
      t('findingMatch.cancelConfirmTitle'),
      t('findingMatch.cancelConfirmMessage'),
      [
        { text: t('findingMatch.cancelConfirmDismiss'), style: 'cancel' },
        { text: t('findingMatch.cancelConfirmAction'), style: 'destructive', onPress: handleCancelConfirmed },
      ]
    );
  };

  const handleCancelConfirmed = async () => {
    setCancelError(null);
    setIsCancelling(true);
    const { error } = await cancelPassengerRequest(request.id);
    setIsCancelling(false);

    if (error) {
      console.warn('cancelPassengerRequest failed', error);
      setCancelError(t('findingMatch.cancelError'));
      return;
    }

    onCancelled();
  };

  return (
    <ScreenBackground
      source={require('../../assets/bg-content.png')}
      naturalWidth={317}
      naturalHeight={1536}
      scrimColor={overlays.scrimHeavy}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>

        <Text style={styles.title}>{t('findingMatch.title')}</Text>
        <Text style={styles.subtitle}>{t('findingMatch.subtitle')}</Text>

        <View style={styles.avatarRow}>
          {PLACEHOLDER_AVATARS.map((source, index) => (
            <Animated.View
              key={index}
              style={[styles.avatarFrame, index === 1 && styles.avatarFrameRaised, breatheStyle]}
            >
              <Image source={source} style={styles.avatarImage} resizeMode="cover" />
            </Animated.View>
          ))}
        </View>

        <View style={styles.centerStage}>
          <Animated.View style={[styles.pulseRing, ringStyle]} />
          <View style={styles.iconGlow}>
            <Image source={require('../../assets/icon-adaptive-fg.png')} style={styles.centerIcon} resizeMode="contain" />
          </View>
        </View>

        <Card style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoStat}>
              <Text style={styles.infoStatLabel}>{t('findingMatch.maxWaitLabel')}</Text>
              <Text style={styles.infoStatValue}>
                {t('findingMatch.maxWaitValue', { minutes: request.max_wait_minutes })}
              </Text>
            </View>
            <SecondaryButton label={t('findingMatch.editButton')} icon="create-outline" onPress={onEdit} />
          </View>
        </Card>

        <Card style={styles.tipCard}>
          <View style={styles.tipRow}>
            <Ionicons name="bulb-outline" size={20} color={colors.accentGold} />
            <Text style={styles.tipText}>{t('findingMatch.tip')}</Text>
          </View>
        </Card>

        {cancelError ? (
          <ErrorNotice message={cancelError} onRetry={handleCancelConfirmed} retryLabel={t('common.retry')} />
        ) : null}

        <Pressable
          style={styles.cancelButton}
          onPress={handleCancelPress}
          disabled={isCancelling}
          accessibilityRole="button"
          accessibilityLabel={t('findingMatch.cancelButton')}
          accessibilityState={{ disabled: isCancelling, busy: isCancelling }}
        >
          <Text style={styles.cancelButtonLabel}>
            {isCancelling ? t('findingMatch.cancelling') : t('findingMatch.cancelButton')}
          </Text>
        </Pressable>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x12,
    alignItems: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: overlays.overlayWhite08,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.x6,
  },
  title: {
    ...baseText.h2,
    textAlign: 'center',
    marginBottom: spacing.x2,
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x8,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.x4,
    marginBottom: spacing.x8,
  },
  avatarFrame: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceCard,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...elevation.resting,
  },
  avatarFrameRaised: {
    marginBottom: spacing.x3,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  centerStage: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.x8,
  },
  pulseRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimarySoft,
  },
  iconGlow: {
    width: 108,
    height: 108,
    borderRadius: radii.pill,
    backgroundColor: colors.accentPrimarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.floating,
  },
  centerIcon: {
    // icon-adaptive-fg.png carries a large built-in safe-zone margin (the glyph fills only
    // ~58% x 43% of the source canvas), so it needs a bigger box than icon-full.png did to
    // read at a comparable size inside the 108px glow circle.
    width: 96,
    height: 96,
  },
  infoCard: {
    width: '100%',
    marginBottom: spacing.x4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.x3,
  },
  infoStat: {
    flex: 1,
  },
  infoStatLabel: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  infoStatValue: {
    ...baseText.body,
    fontWeight: '600',
  },
  tipCard: {
    width: '100%',
    marginBottom: spacing.x6,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
  },
  tipText: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  cancelButton: {
    width: '100%',
    minHeight: 52,
    paddingHorizontal: spacing.x6,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonLabel: {
    ...baseText.body,
    color: colors.dangerStrong,
    fontWeight: '700',
  },
});
