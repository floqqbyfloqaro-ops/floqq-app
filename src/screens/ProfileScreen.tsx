import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import { CARD_SETUP_SUPPORTED, presentCardSetupSheet } from '../services/cardSetup';
import { createCardSetupSession, fetchSavedCard, SavedCard } from '../services/payments';
import { baseText, colors, overlays, spacing } from '../theme/colors';

type Props = {
  onBack: () => void;
};

// The card only counts as saved once Stripe's webhook has reached our server, which usually takes
// a second or two after the sheet closes - so poll briefly for the new card before giving up.
const SAVE_POLL_ATTEMPTS = 8;
const SAVE_POLL_INTERVAL_MS = 1500;

const WALLET_LABEL_KEYS: Record<string, string> = {
  google_pay: 'profile.walletGooglePay',
  apple_pay: 'profile.walletApplePay',
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newAttemptId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ProfileScreen({ onBack }: Props) {
  const { t } = useTranslation();

  const [card, setCard] = useState<SavedCard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCard = useCallback(async () => {
    setErrorMessage(null);
    const { card: savedCard, error } = await fetchSavedCard();
    setIsLoading(false);
    setIsRefreshing(false);
    if (error) {
      console.warn('fetchSavedCard failed', error);
      setErrorMessage(t('profile.loadError'));
      return;
    }
    setCard(savedCard);
  }, [t]);

  useEffect(() => {
    loadCard();
  }, [loadCard]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadCard();
  };

  const handleSetupCard = async () => {
    setErrorMessage(null);
    setNotice(null);
    setIsSaving(true);

    const { session, error } = await createCardSetupSession(newAttemptId());
    if (error || !session) {
      console.warn('createCardSetupSession failed', error);
      setIsSaving(false);
      setErrorMessage(t('profile.setupError'));
      return;
    }

    const result = await presentCardSetupSheet(session, t('profile.merchantName'));
    if (result.status === 'cancelled') {
      setIsSaving(false);
      return;
    }
    if (result.status === 'failed') {
      console.warn('presentCardSetupSheet failed', result.message);
      setIsSaving(false);
      setErrorMessage(t('profile.setupError'));
      return;
    }

    // Sheet finished - wait for the webhook to record the new card rather than trusting the app.
    setNotice(t('profile.savingCard'));
    const previousId = card?.paymentMethodId ?? null;
    for (let attempt = 0; attempt < SAVE_POLL_ATTEMPTS; attempt += 1) {
      await wait(SAVE_POLL_INTERVAL_MS);
      const { card: savedCard } = await fetchSavedCard();
      if (savedCard && savedCard.paymentMethodId !== previousId) {
        setCard(savedCard);
        setNotice(t('profile.cardSaved'));
        setIsSaving(false);
        return;
      }
    }
    setNotice(t('profile.savingSlow'));
    setIsSaving(false);
  };

  const walletKey = card?.wallet ? WALLET_LABEL_KEYS[card.wallet] : undefined;

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimMedium}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accentPrimaryStrong} />
        }
      >
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
        >
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('profile.title')}</Text>

        <Text style={styles.sectionTitle}>{t('profile.paymentMethodsTitle')}</Text>
        <Text style={styles.intro}>{t('profile.paymentMethodsIntro')}</Text>

        {errorMessage ? <ErrorNotice message={errorMessage} onRetry={loadCard} retryLabel={t('common.retry')} /> : null}

        {isLoading ? (
          <Card accessible accessibilityLabel={t('admin.loading')}>
            <Skeleton width={160} height={22} style={styles.skeletonGap} />
            <Skeleton width={100} height={14} />
          </Card>
        ) : (
          <Card>
            {card ? (
              <View style={styles.cardDetails}>
                {walletKey ? <Text style={styles.walletText}>{t(walletKey)}</Text> : null}
                <Text style={styles.cardLine}>
                  {t('profile.cardLine', { brand: capitalize(card.brand), last4: card.last4 })}
                </Text>
                <Text style={styles.expiryText}>
                  {t('profile.cardExpiry', {
                    month: String(card.expMonth).padStart(2, '0'),
                    year: card.expYear,
                  })}
                </Text>
              </View>
            ) : (
              <Text style={styles.noCardText}>{t('profile.noCard')}</Text>
            )}

            {notice ? (
              <Text style={styles.noticeText} accessibilityLiveRegion="polite">
                {notice}
              </Text>
            ) : null}

            {!CARD_SETUP_SUPPORTED ? (
              <Text style={styles.noticeText}>{t('profile.webNotSupported')}</Text>
            ) : card ? (
              <SecondaryButton label={t('profile.replaceCard')} onPress={handleSetupCard} disabled={isSaving} />
            ) : (
              <PrimaryButton label={t('profile.addCard')} onPress={handleSetupCard} loading={isSaving} />
            )}
          </Card>
        )}
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
  },
  backText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginBottom: spacing.x3,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x6,
  },
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  intro: {
    ...baseText.bodySmall,
    marginBottom: spacing.x4,
  },
  skeletonGap: {
    marginBottom: spacing.x3,
  },
  cardDetails: {
    marginBottom: spacing.x4,
  },
  walletText: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  cardLine: {
    ...baseText.h3,
    marginBottom: spacing.x1,
  },
  expiryText: {
    ...baseText.caption,
  },
  noCardText: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
  },
  noticeText: {
    ...baseText.bodySmall,
    marginBottom: spacing.x4,
  },
});
