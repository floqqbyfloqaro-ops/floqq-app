import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import { supabase } from '../services/supabase';
import { colors } from '../theme/colors';

type Props = {
  onCreateRequest: () => void;
  isAdmin: boolean;
  onOpenAdmin: () => void;
};

export default function HomeScreen({ onCreateRequest, isAdmin, onOpenAdmin }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('home.title')}</Text>
      <Text style={styles.subtitle}>{t('home.subtitle')}</Text>

      <PrimaryButton label={t('home.newRequestButton')} onPress={onCreateRequest} />

      {isAdmin ? (
        <Pressable style={styles.adminButton} onPress={onOpenAdmin}>
          <Text style={styles.adminText}>{t('home.adminButton')}</Text>
        </Pressable>
      ) : null}

      <Pressable style={styles.logoutButton} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.logoutText}>{t('auth.logout')}</Text>
      </Pressable>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
    marginBottom: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    marginBottom: 32,
    textAlign: 'center',
  },
  adminButton: {
    marginTop: 16,
  },
  adminText: {
    color: colors.accent,
    fontWeight: '600',
  },
  logoutButton: {
    marginTop: 24,
  },
  logoutText: {
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
