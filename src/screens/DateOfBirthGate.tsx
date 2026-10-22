import { Ionicons } from '@expo/vector-icons';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
import DateOfBirthField from '../components/DateOfBirthField';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import { fetchMyProfile, setMyDateOfBirth } from '../services/profile';
import { barcelonaToday, isAdultOn, parseIsoDate } from '../services/profileRules';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  // What the passenger came for (the ride request form), shown once the age check passes.
  children: ReactNode;
  onBack: () => void;
};

type GateState = 'loading' | 'loadFailed' | 'missing' | 'underAge' | 'ok';

// Before a passenger creates or edits a ride: an account without a date of birth is asked for it
// once (Google accounts, and accounts from before it was asked at sign-up); one under 18 is told
// kindly that FLOQQ is for adults. The server applies the same rule to every ride regardless.
export default function DateOfBirthGate({ children, onBack }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<GateState>('loading');
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    const { profile, error } = await fetchMyProfile();
    if (error) {
      console.warn('fetchMyProfile failed', error);
      setState('loadFailed');
      return;
    }
    const saved = profile?.dateOfBirth ? parseIsoDate(profile.dateOfBirth) : null;
    if (!saved) setState('missing');
    else setState(isAdultOn(saved, barcelonaToday()) ? 'ok' : 'underAge');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setFieldError(null);
    setSaveError(null);
    if (!dateOfBirth) {
      setFieldError(t('dateOfBirth.required'));
      return;
    }
    setIsSaving(true);
    const result = await setMyDateOfBirth(dateOfBirth);
    setIsSaving(false);
    if (result.error === 'locked') {
      // Saved from another device in the meantime: go by what the server has.
      load();
      return;
    }
    if (result.error) {
      if (result.error === 'invalid') setFieldError(t('dateOfBirth.invalid'));
      else setSaveError(t('dateOfBirth.saveError'));
      return;
    }
    setState(result.status === 'under_age' ? 'underAge' : 'ok');
  };

  if (state === 'ok') return <>{children}</>;

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
        >
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>

        {state === 'loading' ? (
          <Card accessible accessibilityLabel={t('admin.loading')}>
            <Skeleton width="70%" height={22} style={styles.skeletonGap} />
            <Skeleton width="90%" height={14} />
          </Card>
        ) : state === 'loadFailed' ? (
          <ErrorNotice message={t('dateOfBirth.loadError')} onRetry={load} retryLabel={t('common.retry')} />
        ) : state === 'underAge' ? (
          <View style={styles.centered}>
            <View style={styles.icon}>
              <Ionicons name="information-circle-outline" size={40} color={colors.accentPrimaryStrong} />
            </View>
            <Text style={styles.title}>{t('dateOfBirth.underAgeTitle')}</Text>
            <Text style={styles.body}>{t('dateOfBirth.underAge')}</Text>
            <Text style={styles.note}>{t('dateOfBirth.underAgeContact')}</Text>
            <SecondaryButton label={t('admin.back')} onPress={onBack} />
          </View>
        ) : (
          <>
            <Text style={styles.title}>{t('dateOfBirth.askTitle')}</Text>
            <Text style={styles.body}>{t('dateOfBirth.askBody')}</Text>
            <Text style={styles.label}>{t('dateOfBirth.label')}</Text>
            <DateOfBirthField value={dateOfBirth} onChange={setDateOfBirth} errorText={fieldError ?? undefined} />
            <Text style={styles.note}>{t('dateOfBirth.onceNote')}</Text>
            {saveError ? <ErrorNotice message={saveError} /> : null}
            <PrimaryButton label={t('dateOfBirth.continue')} onPress={handleSave} loading={isSaving} />
          </>
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
    marginBottom: spacing.x6,
  },
  skeletonGap: {
    marginBottom: spacing.x3,
  },
  centered: {
    alignItems: 'stretch',
  },
  icon: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPrimarySoft,
    marginBottom: spacing.x6,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x3,
  },
  body: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x6,
  },
  label: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
  note: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginBottom: spacing.x6,
  },
});
