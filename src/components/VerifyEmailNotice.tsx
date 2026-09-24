import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { resendVerificationEmail, RESEND_COOLDOWN_SECONDS } from '../services/emailVerification';
import { baseText, colors, spacing } from '../theme/colors';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import SecondaryButton from './SecondaryButton';

type Props = {
  email: string;
  onBackToLogin: () => void;
  // True when shown right after sign-up (an email was just sent), so resend starts on cooldown.
  justSent?: boolean;
};

// "Check your inbox" waiting state, shown after sign-up and when a password login is refused
// because the email isn't verified yet.
export default function VerifyEmailNotice({ email, onBackToLogin, justSent }: Props) {
  const { t } = useTranslation();
  const [cooldown, setCooldown] = useState(justSent ? RESEND_COOLDOWN_SECONDS : 0);
  const [isResending, setIsResending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setStatusMessage(null);
    setErrorMessage(null);
    setIsResending(true);
    const { error } = await resendVerificationEmail(email);
    setIsResending(false);

    if (error) {
      console.warn('resendVerificationEmail failed', error);
      setErrorMessage(t('auth.verifyEmailResendError'));
      return;
    }

    setStatusMessage(t('auth.verifyEmailResent'));
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t('auth.verifyEmailTitle')}</Text>
      <Text style={styles.body}>{t('auth.verifyEmailBody')}</Text>
      <Text style={styles.email}>{email}</Text>
      <Text style={styles.hint}>{t('auth.verifyEmailSpamHint')}</Text>

      {statusMessage ? (
        <Text style={styles.status} accessibilityLiveRegion="polite">
          {statusMessage}
        </Text>
      ) : null}
      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

      <View style={styles.actions}>
        <SecondaryButton
          label={
            cooldown > 0
              ? t('auth.verifyEmailResendIn', { seconds: cooldown })
              : t('auth.verifyEmailResend')
          }
          onPress={handleResend}
          loading={isResending}
          disabled={cooldown > 0}
          icon="mail-outline"
        />
        <SecondaryButton label={t('auth.backToLogin')} onPress={onBackToLogin} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x2,
  },
  body: {
    ...baseText.body,
    color: colors.textSecondary,
  },
  email: {
    ...baseText.body,
    fontWeight: '700',
    marginTop: spacing.x1,
    marginBottom: spacing.x3,
  },
  hint: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
  },
  status: {
    ...baseText.bodySmall,
    color: colors.success,
    marginBottom: spacing.x3,
  },
  actions: {
    gap: spacing.x2,
  },
});
