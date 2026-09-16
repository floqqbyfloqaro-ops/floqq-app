import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import { supabase } from '../services/supabase';
import { baseText, colors, overlays, spacing } from '../theme/colors';

type Props = {
  onBackToLogin: () => void;
};

export default function ForgotPasswordScreen({ onBackToLogin }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSendResetLink = async () => {
    setErrorMessage(null);
    setSendError(null);
    setInfoMessage(null);

    if (!email.trim()) {
      setErrorMessage(t('auth.missingEmailError'));
      return;
    }

    setIsSubmitting(true);
    // The link this email contains opens a plain web page hosted on GitHub Pages (docs/reset-password.html),
    // not the app - Expo Go doesn't register a custom URL scheme, so a floqq:// deep link can't
    // reliably be handed back to the app without a real dev/standalone build. It's hosted off
    // Supabase's own domain deliberately: Supabase sandboxes (forces text/plain + CSP) any redirect
    // target that lives on *.supabase.co itself, which broke rendering when it was an Edge Function.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'https://floqqbyfloqaro-ops.github.io/floqq-app/reset-password.html',
    });
    setIsSubmitting(false);

    if (error) {
      console.warn('resetPasswordForEmail failed', error);
      setSendError(t('auth.resetLinkError'));
      return;
    }

    setInfoMessage(t('auth.resetEmailSentMessage'));
  };

  return (
    <ScreenBackground
      source={require('../../assets/bg-hero.png')}
      naturalWidth={329}
      naturalHeight={1536}
      scrimColor={overlays.scrimHeavy}
    >
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
        <Text style={styles.subtitle}>{t('auth.resetPasswordSubtitle')}</Text>

        <AuthTextInput
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        {sendError ? <ErrorNotice message={sendError} onRetry={handleSendResetLink} retryLabel={t('common.retry')} /> : null}
        {infoMessage ? <Text style={styles.info}>{infoMessage}</Text> : null}

        <PrimaryButton label={t('auth.sendResetLink')} onPress={handleSendResetLink} loading={isSubmitting} />

        <Pressable
          onPress={onBackToLogin}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('auth.backToLogin')}
        >
          <Text style={styles.switchText}>{t('auth.backToLogin')}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.x6,
    justifyContent: 'center',
  },
  title: {
    ...baseText.h1,
    textAlign: 'center',
    marginBottom: spacing.x2,
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x8,
  },
  error: {
    ...baseText.bodySmall,
    color: colors.dangerStrong,
    marginBottom: spacing.x4,
    textAlign: 'center',
  },
  info: {
    ...baseText.bodySmall,
    color: colors.info,
    marginBottom: spacing.x4,
    textAlign: 'center',
  },
  switchText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginTop: spacing.x2,
  },
});
