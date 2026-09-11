import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import PrimaryButton from '../components/PrimaryButton';
import { supabase } from '../services/supabase';
import { colors } from '../theme/colors';

type Props = {
  onSwitchToLogin: () => void;
};

export default function SignUpScreen({ onSwitchToLogin }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (!data.session) {
      setInfoMessage(t('auth.confirmEmailMessage'));
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>{t('auth.signUpTitle')}</Text>

      <AuthTextInput
        placeholder={t('auth.emailPlaceholder')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />
      <AuthTextInput
        placeholder={t('auth.passwordPlaceholder')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {infoMessage ? <Text style={styles.info}>{infoMessage}</Text> : null}

      <PrimaryButton label={t('auth.signUpButton')} onPress={handleSignUp} loading={isSubmitting} />

      <Pressable onPress={onSwitchToLogin}>
        <Text style={styles.switchText}>
          {t('auth.haveAccount')} <Text style={styles.switchLink}>{t('auth.loginLink')}</Text>
        </Text>
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
    color: colors.textSecondary,
    textAlign: 'center',
  },
  switchLink: {
    color: colors.primary,
    fontWeight: '600',
  },
});
