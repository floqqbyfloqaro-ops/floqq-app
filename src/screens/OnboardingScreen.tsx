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

export default function OnboardingScreen({ onComplete }: Props) {
  const { t } = useTranslation();
  const [isRequesting, setIsRequesting] = useState(false);

  const handleContinue = async () => {
    setIsRequesting(true);
    await requestLocationPermission();
    await requestNotificationPermission();
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
