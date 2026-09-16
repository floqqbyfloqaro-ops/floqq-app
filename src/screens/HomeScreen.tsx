import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import { supabase } from '../services/supabase';
import { baseText, colors, overlays, spacing } from '../theme/colors';

type Props = {
  onCreateRequest: () => void;
  onOpenMyRide: () => void;
  isAdmin: boolean;
  onOpenAdmin: () => void;
};

export default function HomeScreen({ onCreateRequest, onOpenMyRide, isAdmin, onOpenAdmin }: Props) {
  const { t } = useTranslation();

  return (
    <ScreenBackground
      source={require('../../assets/bg-content.png')}
      naturalWidth={317}
      naturalHeight={1536}
      scrimColor={overlays.scrimMedium}
    >
      <View style={styles.container}>
        <Text style={styles.title}>{t('home.title')}</Text>
        <Text style={styles.subtitle}>{t('home.subtitle')}</Text>

        <View style={styles.actions}>
          <PrimaryButton label={t('home.newRequestButton')} onPress={onCreateRequest} />
          <SecondaryButton label={t('home.myRideButton')} onPress={onOpenMyRide} />
          {isAdmin ? <SecondaryButton label={t('home.adminButton')} onPress={onOpenAdmin} /> : null}
        </View>

        <Pressable
          style={styles.logoutButton}
          onPress={() => supabase.auth.signOut()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('auth.logout')}
        >
          <Text style={styles.logoutText}>{t('auth.logout')}</Text>
        </Pressable>

        <StatusBar style="light" />
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.x6,
  },
  title: {
    ...baseText.h1,
    marginBottom: spacing.x2,
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x8,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.x2,
  },
  logoutButton: {
    marginTop: spacing.x6,
  },
  logoutText: {
    ...baseText.caption,
    textDecorationLine: 'underline',
  },
});
