import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import PrimaryButton from '../components/PrimaryButton';
import { supabase } from '../services/supabase';
import { colors } from '../theme/colors';

type Props = {
  onSwitchToSignUp: () => void;
  onForgotPassword: () => void;
};

export default function LoginScreen({ onSwitchToSignUp, onForgotPassword }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (error) {
      setErrorMessage(error.message);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>{t('auth.loginTitle')}</Text>

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

      <PrimaryButton label={t('auth.loginButton')} onPress={handleLogin} loading={isSubmitting} />

      <Pressable onPress={onForgotPassword}>
        <Text style={styles.forgotPasswordText}>{t('auth.forgotPasswordLink')}</Text>
      </Pressable>

      <Pressable onPress={onSwitchToSignUp}>
        <Text style={styles.switchText}>
          {t('auth.noAccount')} <Text style={styles.switchLink}>{t('auth.signUpLink')}</Text>
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
  forgotPasswordText: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
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
