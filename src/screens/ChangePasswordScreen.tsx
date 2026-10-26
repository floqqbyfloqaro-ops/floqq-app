import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInputInstance, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import { FieldError, canSave, confirmError, MIN_PASSWORD_LENGTH, newPasswordError, PasswordStrength, passwordStrength } from '../services/passwordRules';
import { changePassword, fetchMyAccount, sendPasswordResetLink } from '../services/profile';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  onBack: () => void;
};

// How long "Your password has been updated" shows before going back to Profile.
const SUCCESS_SHOWN_MS = 1500;

const FIELD_ERROR_KEYS: Record<FieldError, string> = {
  too_short: 'changePassword.tooShort',
  too_long: 'changePassword.tooLong',
  same_as_current: 'changePassword.sameAsCurrent',
  mismatch: 'changePassword.mismatch',
};

const STRENGTH_STEPS: Record<PasswordStrength, { filled: number; color: string }> = {
  weak: { filled: 1, color: colors.danger },
  fair: { filled: 2, color: colors.warning },
  strong: { filled: 3, color: colors.success },
};

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Profile -> "Change password" (email accounts only; Apple and Google accounts have no FLOQQ
// password). The change-password Edge Function has Supabase Auth check the current password,
// limits wrong tries, signs out the passenger's other devices and emails them. The fields are
// marked for password managers: the account's email as the username, the current password, and
// the new one (so it can be saved).
export default function ChangePasswordScreen({ onBack }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const newRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);

  useEffect(() => {
    fetchMyAccount().then(({ account }) => setEmail(account?.email ?? ''));
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(onBack, SUCCESS_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [success, onBack]);

  const form = { current, next, confirm };
  const nextError = newPasswordError(form);
  const matchError = confirmError(form);
  const strength = passwordStrength(next);
  const saveEnabled = canSave(form) && !isSaving && !success;

  const handleSave = async () => {
    if (!canSave(form)) return;
    setCurrentError(null);
    setErrorMessage(null);
    setIsSaving(true);
    const result = await changePassword(current, next);
    setIsSaving(false);
    switch (result.status) {
      case 'changed':
        setSuccess(true);
        return;
      case 'wrong_current':
        setCurrentError(
          result.attemptsLeft != null ? t('changePassword.wrongCurrentLeft', { count: result.attemptsLeft }) : t('changePassword.wrongCurrent')
        );
        return;
      case 'locked':
        setCurrentError(t('changePassword.locked', { time: clockTime(result.retryAt) }));
        return;
      case 'too_short':
      case 'same_as_current':
        setErrorMessage(t(FIELD_ERROR_KEYS[result.status]));
        return;
      default:
        setErrorMessage(t('changePassword.failed'));
    }
  };

  const handleForgot = async () => {
    if (!email || resetState === 'sending') return;
    setResetState('sending');
    const { error } = await sendPasswordResetLink(email);
    setResetState(error ? 'failed' : 'sent');
  };

  const eye = (field: keyof typeof visible) => ({
    trailingIcon: visible[field] ? ('eye-off-outline' as const) : ('eye-outline' as const),
    onTrailingIconPress: () => setVisible((v) => ({ ...v, [field]: !v[field] })),
    trailingIconLabel: visible[field] ? t('auth.hidePassword') : t('auth.showPassword'),
    secureTextEntry: !visible[field],
  });

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimMedium}
    >
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Pressable
            onPress={onBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('admin.back')}
          >
            <Text style={styles.backText}>{t('admin.back')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('changePassword.title')}</Text>

          {success ? (
            <Text style={styles.successText} accessibilityLiveRegion="polite">
              {t('changePassword.success')}
            </Text>
          ) : (
            <>
              {/* The account, for password managers to save the new password against. */}
              <AuthTextInput
                variant="card"
                leadingIcon="mail-outline"
                value={email}
                editable={false}
                textContentType="username"
                autoComplete="username"
                accessibilityLabel={t('auth.emailPlaceholder')}
              />

              <AuthTextInput
                variant="card"
                leadingIcon="lock-closed-outline"
                {...eye('current')}
                placeholder={t('changePassword.currentPassword')}
                value={current}
                onChangeText={(value) => {
                  setCurrent(value);
                  setCurrentError(null);
                }}
                errorText={currentError ?? undefined}
                textContentType="password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => newRef.current?.focus()}
                submitBehavior="submit"
              />

              <AuthTextInput
                ref={newRef}
                variant="card"
                leadingIcon="key-outline"
                {...eye('next')}
                placeholder={t('changePassword.newPassword')}
                value={next}
                onChangeText={setNext}
                errorText={nextError ? t(FIELD_ERROR_KEYS[nextError]) : undefined}
                helperText={nextError ? undefined : t('changePassword.rules', { min: MIN_PASSWORD_LENGTH })}
                textContentType="newPassword"
                autoComplete="new-password"
                passwordRules={`minlength: ${MIN_PASSWORD_LENGTH};`}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
                submitBehavior="submit"
              />
              {strength ? (
                <View style={styles.strength} accessible accessibilityLabel={t(`changePassword.strength.${strength}`)}>
                  <View style={styles.strengthBars}>
                    {[1, 2, 3].map((step) => (
                      <View
                        key={step}
                        style={[styles.strengthBar, step <= STRENGTH_STEPS[strength].filled && { backgroundColor: STRENGTH_STEPS[strength].color }]}
                      />
                    ))}
                  </View>
                  <Text style={styles.strengthText}>{t(`changePassword.strength.${strength}`)}</Text>
                </View>
              ) : null}

              <AuthTextInput
                ref={confirmRef}
                variant="card"
                leadingIcon="key-outline"
                {...eye('confirm')}
                placeholder={t('changePassword.confirmPassword')}
                value={confirm}
                onChangeText={setConfirm}
                errorText={matchError ? t(FIELD_ERROR_KEYS[matchError]) : undefined}
                textContentType="newPassword"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />

              {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

              <PrimaryButton label={t('changePassword.save')} onPress={handleSave} loading={isSaving} disabled={!saveEnabled} />

              <Pressable
                onPress={handleForgot}
                disabled={resetState === 'sending' || resetState === 'sent'}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                style={styles.forgot}
              >
                <Text style={styles.linkText}>{t('changePassword.forgot')}</Text>
              </Pressable>
              {resetState === 'sent' ? (
                <Text style={styles.note} accessibilityLiveRegion="polite">
                  {t('changePassword.resetSent', { email })}
                </Text>
              ) : resetState === 'failed' ? (
                <Text style={styles.errorNote} accessibilityLiveRegion="polite">
                  {t('auth.resetLinkError')}
                </Text>
              ) : null}
            </>
          )}
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
  strength: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginTop: -spacing.x2,
    marginBottom: spacing.x4,
  },
  strengthBars: {
    flexDirection: 'row',
    gap: spacing.x1,
    flex: 1,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderSubtle,
  },
  strengthText: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  successText: {
    ...baseText.body,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.x6,
  },
  forgot: {
    marginTop: spacing.x4,
    alignSelf: 'center',
  },
  linkText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
  note: {
    ...baseText.bodySmall,
    color: colors.info,
    textAlign: 'center',
    marginTop: spacing.x2,
  },
  errorNote: {
    ...baseText.bodySmall,
    color: colors.dangerStrong,
    textAlign: 'center',
    marginTop: spacing.x2,
  },
});
