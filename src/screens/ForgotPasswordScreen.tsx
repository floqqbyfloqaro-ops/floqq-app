import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

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
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image source={require('../../assets/icon-full.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.wordmark}>FLOQQ</Text>

          <Text style={styles.title}>{t('auth.resetPasswordTitle')}</Text>
          <Text style={styles.subtitle}>{t('auth.resetPasswordSubtitle')}</Text>

          <AuthTextInput
            variant="card"
            leadingIcon="mail-outline"
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
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x12,
    alignItems: 'center',
  },
  logo: {
    width: 64,
    height: 64,
  },
  wordmark: {
    ...baseText.h1,
    marginTop: spacing.x2,
    marginBottom: spacing.x6,
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
