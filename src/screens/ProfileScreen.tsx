import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from '../components/Avatar';
import AvatarPickerSheet from '../components/AvatarPickerSheet';
import Card from '../components/Card';
import { formatDateOfBirth } from '../components/DateOfBirthField';
import EditProfileForm from '../components/EditProfileForm';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import TestModeBadge from '../components/TestModeBadge';
import { CARD_SETUP_SUPPORTED, presentCardSetupSheet } from '../services/cardSetup';
import { RESEND_COOLDOWN_SECONDS } from '../services/emailVerification';
import {
  cancelEmailChange,
  fetchMyAccount,
  fetchMyProfile,
  MyAccount,
  MyProfile,
  resendEmailChange,
} from '../services/profile';
import { useMyAvatarId } from '../services/myAvatar';
import { createCardSetupSession, fetchSavedCard, SavedCard } from '../services/payments';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  onBack: () => void;
  // "Help": the AI support assistant (HelpScreen).
  onOpenHelp: () => void;
  // "Change password" (email accounts only).
  onChangePassword: () => void;
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

export default function ProfileScreen({ onBack, onOpenHelp, onChangePassword }: Props) {
  const { t, i18n } = useTranslation();

  // The passenger's own details: name and date of birth (profile), email and how they sign in
  // (account).
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [account, setAccount] = useState<MyAccount | null>(null);
  const [isAccountLoading, setIsAccountLoading] = useState(true);
  const [accountLoadFailed, setAccountLoadFailed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isChoosingAvatar, setIsChoosingAvatar] = useState(false);
  const myAvatarId = useMyAvatarId();
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [emailAction, setEmailAction] = useState<'resend' | 'cancel' | null>(null);
  const [emailActionMessage, setEmailActionMessage] = useState<string | null>(null);
  const [resendBlockedUntil, setResendBlockedUntil] = useState(0);

  const loadAccount = useCallback(async () => {
    const [profileResult, accountResult] = await Promise.all([fetchMyProfile(), fetchMyAccount()]);
    setIsAccountLoading(false);
    if (profileResult.error || accountResult.error || !accountResult.account) {
      console.warn('loading the profile failed', profileResult.error ?? accountResult.error);
      setAccountLoadFailed(true);
      return;
    }
    setAccountLoadFailed(false);
    setProfile(profileResult.profile ?? { firstName: '', lastName: '', dateOfBirth: null, underAgeAt: null });
    setAccount(accountResult.account);
  }, []);

  // Read again on every return to the app: an email change may just have been confirmed in the
  // browser.
  useEffect(() => {
    loadAccount();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadAccount();
    });
    return () => subscription.remove();
  }, [loadAccount]);

  const handleResendEmail = async () => {
    if (!account?.pendingEmail) return;
    setEmailActionMessage(null);
    if (Date.now() < resendBlockedUntil) {
      setEmailActionMessage(t('profile.resendWait', { seconds: Math.ceil((resendBlockedUntil - Date.now()) / 1000) }));
      return;
    }
    setEmailAction('resend');
    const { error } = await resendEmailChange(account.pendingEmail);
    setEmailAction(null);
    if (error) {
      setEmailActionMessage(t(error === 'rate_limited' ? 'profileEdit.emailRateLimited' : 'profile.resendError'));
      return;
    }
    setResendBlockedUntil(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    setEmailActionMessage(t('profile.resendDone', { email: account.pendingEmail }));
  };

  const handleCancelEmailChange = async () => {
    setEmailActionMessage(null);
    setEmailAction('cancel');
    const { error } = await cancelEmailChange();
    setEmailAction(null);
    if (error) {
      setEmailActionMessage(t('profile.cancelEmailError'));
      return;
    }
    setEmailActionMessage(t('profile.cancelEmailDone'));
    await loadAccount();
  };

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
    loadAccount();
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
        {isEditing && profile && account ? (
          <EditProfileForm
            profile={profile}
            account={account}
            onCancel={() => setIsEditing(false)}
            onSaved={(message) => {
              setIsEditing(false);
              setProfileNotice(message);
              setEmailActionMessage(null);
              loadAccount();
            }}
          />
        ) : (
          <>
            <Text style={styles.title}>{t('profile.title')}</Text>

            {accountLoadFailed ? (
              <ErrorNotice message={t('profile.accountLoadError')} onRetry={loadAccount} retryLabel={t('common.retry')} />
            ) : null}

            {isAccountLoading ? (
              <Card style={styles.accountCard} accessible accessibilityLabel={t('admin.loading')}>
                <Skeleton width={88} height={88} radius={radii.pill} style={styles.skeletonGap} />
                <Skeleton width={180} height={22} style={styles.skeletonGap} />
                <Skeleton width={220} height={14} />
              </Card>
            ) : profile && account ? (
              <Card style={styles.accountCard}>
                <View style={styles.identity}>
                  <Pressable
                    onPress={() => setIsChoosingAvatar(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t('avatar.editLabel')}
                    style={({ pressed }) => pressed && styles.avatarPressed}
                  >
                    <Avatar avatarId={myAvatarId} size="large" />
                    <View style={styles.avatarEditBadge}>
                      <Ionicons name="pencil" size={14} color={colors.white} />
                    </View>
                  </Pressable>
                  <Text style={styles.name}>
                    {`${profile.firstName} ${profile.lastName}`.trim() || t('profile.nameMissing')}
                  </Text>
                </View>

                {profileNotice ? (
                  <Text style={styles.successText} accessibilityLiveRegion="polite">
                    {profileNotice}
                  </Text>
                ) : null}

                <Text style={styles.fieldLabel}>{t('profile.emailLabel')}</Text>
                <Text style={styles.fieldValue} selectable>
                  {account.email}
                </Text>
                {account.provider !== 'email' ? (
                  <Text style={styles.fieldNote}>
                    {t(account.provider === 'apple' ? 'profile.emailManagedApple' : 'profile.emailManagedGoogle')}
                  </Text>
                ) : account.pendingEmail ? (
                  <View style={styles.pending}>
                    <Text style={styles.pendingText}>{t('profile.emailPending', { email: account.pendingEmail })}</Text>
                    <Text style={styles.fieldNote}>{t('profile.emailPendingHelp')}</Text>
                    <View style={styles.pendingActions}>
                      <Pressable
                        onPress={handleResendEmail}
                        disabled={emailAction != null}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        accessibilityRole="button"
                      >
                        <Text style={styles.linkText}>{t('profile.resendEmail')}</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleCancelEmailChange}
                        disabled={emailAction != null}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        accessibilityRole="button"
                      >
                        <Text style={styles.linkText}>{t('profile.cancelEmailChange')}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                {emailActionMessage ? (
                  <Text style={styles.fieldNote} accessibilityLiveRegion="polite">
                    {emailActionMessage}
                  </Text>
                ) : null}

                <Text style={styles.fieldLabel}>{t('profile.dateOfBirthLabel')}</Text>
                <Text style={styles.fieldValue}>
                  {profile.dateOfBirth ? formatDateOfBirth(profile.dateOfBirth, i18n.language) : t('profile.dateOfBirthMissing')}
                </Text>
                {profile.dateOfBirth ? <Text style={styles.fieldNote}>{t('profile.dateOfBirthLocked')}</Text> : null}

                <View style={styles.editButton}>
                  <SecondaryButton
                    label={t('profile.editButton')}
                    icon="create-outline"
                    onPress={() => {
                      setProfileNotice(null);
                      setIsEditing(true);
                    }}
                  />
                </View>
              </Card>
            ) : null}

            {/* Apple and Google accounts have no FLOQQ password: only how they sign in. */}
            {account ? (
              account.provider === 'email' ? (
                <Card onPress={onChangePassword} style={styles.passwordRow} accessibilityLabel={t('changePassword.row')}>
                  <View style={styles.rowInner}>
                    <Ionicons name="lock-closed-outline" size={22} color={colors.accentPrimaryStrong} />
                    <Text style={styles.rowText}>{t('changePassword.row')}</Text>
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                  </View>
                </Card>
              ) : (
                <Card style={styles.passwordRow}>
                  <View style={styles.rowInner}>
                    <Ionicons name={account.provider === 'apple' ? 'logo-apple' : 'logo-google'} size={22} color={colors.textSecondary} />
                    <Text style={styles.rowText}>
                      {t(account.provider === 'apple' ? 'changePassword.signedInWithApple' : 'changePassword.signedInWithGoogle')}
                    </Text>
                  </View>
                </Card>
              )
            ) : null}

            <Text style={styles.sectionTitle}>{t('profile.paymentMethodsTitle')}</Text>
            <TestModeBadge />
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

            <View style={styles.helpSection}>
              <Text style={styles.sectionTitle}>{t('profile.helpTitle')}</Text>
              <Text style={styles.intro}>{t('profile.helpIntro')}</Text>
              <SecondaryButton label={t('profile.helpButton')} icon="help-circle-outline" onPress={onOpenHelp} />
            </View>
          </>
        )}
      </ScrollView>
      <AvatarPickerSheet visible={isChoosingAvatar} onClose={() => setIsChoosingAvatar(false)} />
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
  accountCard: {
    marginBottom: spacing.x8,
  },
  identity: {
    alignItems: 'center',
    gap: spacing.x3,
    marginBottom: spacing.x4,
  },
  avatarPressed: {
    opacity: 0.8,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    backgroundColor: colors.accentPrimary,
    borderWidth: 2,
    borderColor: colors.surfaceCardSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    ...baseText.h3,
    textAlign: 'center',
  },
  fieldLabel: {
    ...baseText.label,
    marginTop: spacing.x4,
    marginBottom: spacing.x1,
  },
  fieldValue: {
    ...baseText.body,
  },
  fieldNote: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: spacing.x1,
  },
  pending: {
    marginTop: spacing.x2,
  },
  pendingText: {
    ...baseText.bodySmall,
    color: colors.warning,
    fontWeight: '600',
  },
  pendingActions: {
    flexDirection: 'row',
    gap: spacing.x6,
    marginTop: spacing.x3,
  },
  linkText: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  successText: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginBottom: spacing.x2,
  },
  editButton: {
    marginTop: spacing.x6,
  },
  passwordRow: {
    marginTop: -spacing.x4,
    marginBottom: spacing.x8,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
  },
  rowText: {
    ...baseText.body,
    flex: 1,
  },
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  helpSection: {
    marginTop: spacing.x8,
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
