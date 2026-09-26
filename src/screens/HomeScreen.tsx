import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import { SERVICE_FEE_EUR } from '../constants';
import { cancelPassengerRequest, fetchMyActiveRequest, MyActiveRequest } from '../services/passengerRequests';
import { signOutAndUnregisterPush } from '../services/pushNotifications';
import { baseText, colors, overlays, spacing } from '../theme/colors';

type Props = {
  onCreateRequest: () => void;
  onOpenMyRide: () => void;
  isAdmin: boolean;
  onOpenAdmin: () => void;
  // Only shown with the payments prototype switched on (PAYMENTS_ENABLED).
  showProfile: boolean;
  onOpenProfile: () => void;
  // Set after the passenger arrives from the email-verified page's "Open FLOQQ" link.
  showEmailVerified?: boolean;
  onDismissEmailVerified?: () => void;
};

// A passenger can only have one active ride. Tapping "New ride request" while one exists shows
// this inline panel instead of the form - inline rather than Alert.alert, because multi-button
// alerts are a no-op on react-native-web.
type ActiveRidePrompt = { request: MyActiveRequest; step: 'choose' | 'confirmCancel' };

export default function HomeScreen({
  onCreateRequest,
  onOpenMyRide,
  isAdmin,
  onOpenAdmin,
  showProfile,
  onOpenProfile,
  showEmailVerified,
  onDismissEmailVerified,
}: Props) {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [prompt, setPrompt] = useState<ActiveRidePrompt | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleNewRequestPress = async () => {
    setErrorMessage(null);
    setIsChecking(true);
    const { data, error } = await fetchMyActiveRequest();
    setIsChecking(false);

    if (error) {
      console.warn('fetchMyActiveRequest failed', error);
      setErrorMessage(t('home.activeRideCheckError'));
      return;
    }

    if (data) {
      setPrompt({ request: data, step: 'choose' });
      return;
    }

    onCreateRequest();
  };

  const handleCancelAndCreate = async () => {
    if (!prompt) return;
    setErrorMessage(null);
    setIsCancelling(true);
    const { error, blockedReason } = await cancelPassengerRequest(prompt.request.id);
    setIsCancelling(false);

    if (blockedReason === 'group_confirmed') {
      setPrompt({ request: { ...prompt.request, group_status: 'confirmed' }, step: 'choose' });
      return;
    }
    if (error) {
      console.warn('cancelPassengerRequest failed', error);
      setErrorMessage(t('findingMatch.cancelError'));
      return;
    }

    setPrompt(null);
    onCreateRequest();
  };

  const isConfirmedGroup = prompt?.request.group_status === 'confirmed';

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimMedium}
    >
      <View style={styles.container}>
        <Image source={require('../../assets/icon-full.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>{t('home.title')}</Text>
        <Text style={styles.subtitle}>{t('home.subtitle')}</Text>

        {showEmailVerified ? (
          <Card style={styles.verifiedCard} onPress={onDismissEmailVerified} accessibilityRole="button">
            <Text style={styles.verifiedTitle} accessibilityLiveRegion="polite">
              {t('auth.emailVerifiedTitle')}
            </Text>
            <Text style={styles.promptDetail}>{t('auth.emailVerifiedBody')}</Text>
          </Card>
        ) : null}

        {errorMessage ? (
          <View style={styles.errorWrap}>
            <ErrorNotice message={errorMessage} />
          </View>
        ) : null}

        {prompt ? (
          <Card style={styles.promptCard}>
            <Text style={styles.promptText} accessibilityLiveRegion="polite">
              {t('active_ride_exists')}
            </Text>
            {prompt.step === 'confirmCancel' ? (
              <Text style={styles.promptDetail}>
                {isConfirmedGroup
                  ? t('home.activeRideCancelConfirmedWarning', { fee: SERVICE_FEE_EUR.toFixed(2) })
                  : t('home.activeRideCancelConfirm')}
              </Text>
            ) : null}

            <View style={styles.actions}>
              {prompt.step === 'confirmCancel' ? (
                <>
                  <PrimaryButton
                    label={t('home.activeRideCancelConfirmAction')}
                    onPress={handleCancelAndCreate}
                    loading={isCancelling}
                  />
                  <SecondaryButton
                    label={t('home.activeRideKeep')}
                    onPress={() => setPrompt(null)}
                    disabled={isCancelling}
                  />
                </>
              ) : (
                <>
                  <PrimaryButton
                    label={t('home.activeRideView')}
                    onPress={() => {
                      setPrompt(null);
                      onOpenMyRide();
                    }}
                  />
                  <SecondaryButton
                    label={t('home.activeRideCancelAndCreate')}
                    onPress={() => setPrompt({ ...prompt, step: 'confirmCancel' })}
                  />
                  <SecondaryButton label={t('home.activeRideKeep')} onPress={() => setPrompt(null)} />
                </>
              )}
            </View>
          </Card>
        ) : (
          <View style={styles.actions}>
            <PrimaryButton label={t('home.newRequestButton')} onPress={handleNewRequestPress} loading={isChecking} />
            <SecondaryButton label={t('home.myRideButton')} onPress={onOpenMyRide} />
            {showProfile ? <SecondaryButton label={t('home.profileButton')} onPress={onOpenProfile} /> : null}
            {isAdmin ? <SecondaryButton label={t('home.adminButton')} onPress={onOpenAdmin} /> : null}
          </View>
        )}

        <Pressable
          style={styles.logoutButton}
          onPress={() => signOutAndUnregisterPush()}
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
  logo: {
    width: 64,
    height: 64,
    marginBottom: spacing.x2,
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
  errorWrap: {
    alignSelf: 'stretch',
    marginBottom: spacing.x4,
  },
  verifiedCard: {
    alignSelf: 'stretch',
    marginBottom: spacing.x4,
  },
  verifiedTitle: {
    ...baseText.body,
    fontWeight: '700',
    color: colors.success,
    marginBottom: spacing.x1,
  },
  promptCard: {
    alignSelf: 'stretch',
  },
  promptText: {
    ...baseText.body,
    marginBottom: spacing.x2,
  },
  promptDetail: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
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
