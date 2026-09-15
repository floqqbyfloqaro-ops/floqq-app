import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import PrimaryButton from '../components/PrimaryButton';
import { supabase } from '../services/supabase';
import { colors } from '../theme/colors';

type Props = {
  onBackToLogin: () => void;
};

export default function ForgotPasswordScreen({ onBackToLogin }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSendResetLink = async () => {
    setErrorMessage(null);
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
      setErrorMessage(error.message);
      return;
    }

    setInfoMessage(t('auth.resetEmailSentMessage'));
  };

  return (
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
      {infoMessage ? <Text style={styles.info}>{infoMessage}</Text> : null}

      <PrimaryButton label={t('auth.sendResetLink')} onPress={handleSendResetLink} loading={isSubmitting} />

      <Pressable onPress={onBackToLogin}>
        <Text style={styles.switchText}>{t('auth.backToLogin')}</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    marginBottom: 32,
    textAlign: 'center',
  },
  error: {
    color: colors.error,
    marginBottom: 16,
    textAlign: 'center',
  },
  info: {
    color: colors.accent,
    marginBottom: 16,
    textAlign: 'center',
  },
  switchText: {
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },
});
