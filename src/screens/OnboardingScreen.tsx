import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import { requestLocationPermission, requestNotificationPermission } from '../services/permissions';
import { baseText, colors, overlays, spacing } from '../theme/colors';

type Props = {
  onComplete: () => void;
};

// These permission prompts are advisory, not required (the copy on this screen already says as
// much - "you can change these permissions anytime in settings"), so a slow or unresolved one
// must never block onboarding forever. Two real ways that could happen without this: the browser
// permission API can reject instead of resolving in some environments (e.g. an unsupported
// platform), which with a plain sequential `await` and no try/catch stops execution before
// onComplete() is ever called; and on web, an unanswered browser permission prompt (the user
// switches tabs, or ignores it) can leave its promise pending indefinitely.
const PERMISSION_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

export default function OnboardingScreen({ onComplete }: Props) {
  const { t } = useTranslation();
  const [isRequesting, setIsRequesting] = useState(false);

  const handleContinue = async () => {
    setIsRequesting(true);
    await Promise.all([
      withTimeout(requestLocationPermission(), PERMISSION_TIMEOUT_MS),
      withTimeout(requestNotificationPermission(), PERMISSION_TIMEOUT_MS),
    ]);
    setIsRequesting(false);
    onComplete();
  };

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('onboarding.title')}</Text>
          <Text style={styles.subtitle}>{t('onboarding.subtitle')}</Text>
        </View>

        <View style={styles.permissions}>
          <Card>
            <View style={styles.permissionRow}>
              <Text
                style={styles.permissionIcon}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                📍
              </Text>
              <View style={styles.permissionText}>
                <Text style={styles.permissionTitle}>{t('onboarding.locationTitle')}</Text>
                <Text style={styles.permissionDescription}>{t('onboarding.locationDescription')}</Text>
              </View>
            </View>
          </Card>

          <Card>
            <View style={styles.permissionRow}>
              <Text
                style={styles.permissionIcon}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                🔔
              </Text>
              <View style={styles.permissionText}>
                <Text style={styles.permissionTitle}>{t('onboarding.notificationsTitle')}</Text>
                <Text style={styles.permissionDescription}>{t('onboarding.notificationsDescription')}</Text>
              </View>
            </View>
          </Card>
        </View>

        <Text style={styles.note}>{t('onboarding.note')}</Text>

        <PrimaryButton label={t('onboarding.continue')} onPress={handleContinue} loading={isRequesting} />
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.x6,
    justifyContent: 'center',
  },
  header: {
    marginBottom: spacing.x8,
  },
  title: {
    ...baseText.h1,
    marginBottom: spacing.x2,
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
  },
  permissions: {
    gap: spacing.x4,
    marginBottom: spacing.x6,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
  },
  permissionIcon: {
    fontSize: 28,
  },
  permissionText: {
    flex: 1,
  },
  permissionTitle: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  permissionDescription: {
    ...baseText.caption,
  },
  note: {
    ...baseText.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x6,
  },
});
