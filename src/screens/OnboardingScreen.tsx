import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { requestLocationPermission, requestNotificationPermission } from '../services/permissions';
import { colors } from '../theme/colors';

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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('onboarding.title')}</Text>
        <Text style={styles.subtitle}>{t('onboarding.subtitle')}</Text>
      </View>

      <View style={styles.permissions}>
        <View style={styles.permissionCard}>
          <Text style={styles.permissionIcon}>📍</Text>
          <View style={styles.permissionText}>
            <Text style={styles.permissionTitle}>{t('onboarding.locationTitle')}</Text>
            <Text style={styles.permissionDescription}>{t('onboarding.locationDescription')}</Text>
          </View>
        </View>

        <View style={styles.permissionCard}>
          <Text style={styles.permissionIcon}>🔔</Text>
          <View style={styles.permissionText}>
            <Text style={styles.permissionTitle}>{t('onboarding.notificationsTitle')}</Text>
            <Text style={styles.permissionDescription}>{t('onboarding.notificationsDescription')}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.note}>{t('onboarding.note')}</Text>

      <Pressable style={styles.button} onPress={handleContinue} disabled={isRequesting}>
        {isRequesting ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>{t('onboarding.continue')}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  permissions: {
    gap: 16,
    marginBottom: 24,
  },
  permissionCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 12,
  },
  permissionIcon: {
    fontSize: 28,
  },
  permissionText: {
    flex: 1,
  },
  permissionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  permissionDescription: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  note: {
    fontSize: 12,
    color: colors.accent,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
