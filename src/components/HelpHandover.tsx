import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { CountryCode } from 'libphonenumber-js';

import { useReduceMotion } from '../hooks/useReduceMotion';
import {
  CallbackSlot,
  createSupportTicket,
  CreatedTicket,
  fetchSupportInfo,
  HelpLanguage,
  SupportInfo,
  TeamLanguage,
} from '../services/helpChat';
import { toE164 } from '../services/phoneRules';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';
import { barcelonaDateParts, barcelonaWeekday } from '../utils/formatDateTime';
import AuthTextInput from './AuthTextInput';
import CountryCodePicker from './CountryCodePicker';
import ErrorNotice from './ErrorNotice';
import HelpEmergencyCard from './HelpEmergencyCard';
import PrimaryButton from './PrimaryButton';
import Skeleton from './Skeleton';

type Props = {
  conversationId: string;
  // Why it goes to a person: "Talk to a person", "No", or the assistant's own handover rules.
  reason: string;
  appLanguage: HelpLanguage;
  // After "We tried to call you": choose WhatsApp or another call back for the same ticket.
  changeChannel?: boolean;
  onTicket: (ticket: CreatedTicket) => void;
};

const TICKET_ERRORS: Record<string, string> = {
  invalid_phone: 'help.phoneInvalid',
  consent_required: 'help.consentRequired',
  invalid_callback_time: 'help.slotGone',
  whatsapp_unavailable: 'help.whatsappUnavailable',
};

export async function openWhatsAppTicket(ticket: CreatedTicket): Promise<boolean> {
  if (!ticket.whatsapp) return false;
  try {
    await Linking.openURL(`whatsapp://send?phone=${ticket.whatsapp.digits}&text=${encodeURIComponent(ticket.whatsapp.text)}`);
    return true;
  } catch {
    return false;
  }
}

// The handover to the FLOQQ team, inline in the help chat: the language as chips (the app's
// language pre-selected), then two large options - WhatsApp (a message with only the ticket
// reference) or a call back, whose details open in a bottom sheet above the keyboard. Outside
// support hours the passenger first sees when the team is back; after danger, "Call 112" first.
export default function HelpHandover({ conversationId, reason, appLanguage, changeChannel = false, onTicket }: Props) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReduceMotion();
  const [info, setInfo] = useState<SupportInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [language, setLanguage] = useState<TeamLanguage>(appLanguage);
  const [languageChosen, setLanguageChosen] = useState(changeChannel);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [country, setCountry] = useState<CountryCode>('ES');
  const [phone, setPhone] = useState('');
  const [slot, setSlot] = useState<CallbackSlot | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [whatsappFailed, setWhatsappFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const { info: next, error } = await fetchSupportInfo(conversationId);
    if (error || !next) return setLoadFailed(true);
    setInfo(next);
    if (!next.teamLanguages.includes(appLanguage)) setLanguage(next.teamLanguages[0]);
  }, [conversationId, appLanguage]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (channel: 'whatsapp' | 'callback') => {
    setErrorKey(null);
    let e164: string | undefined;
    if (channel === 'callback') {
      e164 = toE164(country, phone) ?? undefined;
      if (!e164) return setErrorKey('help.phoneInvalid');
      if (!consent) return setErrorKey('help.consentRequired');
    }
    setBusy(true);
    const { ticket, error } = await createSupportTicket({
      conversationId,
      reason,
      language,
      channel,
      ...(channel === 'callback' ? { phone: e164, callbackAt: slot?.at ?? null, consent } : {}),
    });
    setBusy(false);
    if (error || !ticket) return setErrorKey(TICKET_ERRORS[error ?? ''] ?? 'help.ticketError');
    if (ticket.channel === 'whatsapp' && !(await openWhatsAppTicket(ticket))) {
      // No WhatsApp on this phone: the ticket exists - offer the call back for it instead.
      setWhatsappFailed(true);
      return;
    }
    setSheetOpen(false);
    onTicket(ticket);
  };

  const when = (iso: string) => {
    const { hour, minute } = barcelonaDateParts(iso);
    return t('help.weekdayTime', { weekday: barcelonaWeekday(iso, i18n.language), time: `${hour}:${minute}` });
  };

  if (loadFailed) return <ErrorNotice message={t('help.handoverLoadError')} onRetry={load} retryLabel={t('common.retry')} />;
  if (!info) {
    return (
      <View style={styles.box} accessible accessibilityLabel={t('admin.loading')}>
        <Skeleton width={200} height={18} />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      {info.emergency ? <HelpEmergencyCard /> : null}
      <Text style={styles.title} accessibilityRole="header">
        {t('help.handoverTitle')}
      </Text>
      {!info.openNow ? (
        <Text style={styles.notice} accessibilityLiveRegion="polite">
          {info.nextOpenAt ? t('help.outsideHours', { when: when(info.nextOpenAt) }) : t('help.noHours')}
        </Text>
      ) : null}

      {!languageChosen ? (
        <>
          <Text style={styles.question}>{t('help.languageQuestion')}</Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {info.teamLanguages.map((code) => (
              <Pressable
                key={code}
                onPress={() => {
                  setLanguage(code);
                  setLanguageChosen(true);
                }}
                style={[styles.chip, language === code && styles.chipSelected]}
                accessibilityRole="radio"
                accessibilityState={{ checked: language === code }}
              >
                <Text style={styles.chipText}>{t(`help.languageName.${code}`)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <>
          <Pressable onPress={() => setLanguageChosen(false)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.chosen}>{t('help.teamLanguage', { language: t(`help.languageName.${language}`) })}</Text>
          </Pressable>
          <Text style={styles.question}>{t('help.channelQuestion')}</Text>
          {errorKey && !sheetOpen ? <ErrorNotice message={t(errorKey)} /> : null}
          <View style={styles.options}>
            <Pressable
              onPress={() => submit('whatsapp')}
              disabled={!info.whatsapp || busy}
              style={[styles.option, (!info.whatsapp || busy) && styles.optionDisabled]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !info.whatsapp || busy }}
              accessibilityHint={!info.whatsapp ? t('help.whatsappComingSoon') : undefined}
            >
              <Ionicons name="logo-whatsapp" size={28} color={info.whatsapp ? colors.success : colors.textDisabled} />
              <Text style={styles.optionTitle}>{t('help.whatsappOption')}</Text>
              <Text style={styles.optionText}>{info.whatsapp ? t('help.whatsappHint') : t('help.whatsappComingSoon')}</Text>
            </Pressable>
            <Pressable onPress={() => setSheetOpen(true)} disabled={busy} style={styles.option} accessibilityRole="button">
              <Ionicons name="call-outline" size={28} color={colors.accentPrimaryStrong} />
              <Text style={styles.optionTitle}>{t('help.callbackOption')}</Text>
              <Text style={styles.optionText}>{t('help.callbackHint')}</Text>
            </Pressable>
          </View>
          {whatsappFailed ? <Text style={styles.warning}>{t('help.whatsappNotInstalled')}</Text> : null}
        </>
      )}

      <Modal visible={sheetOpen} transparent animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={() => setSheetOpen(false)} accessibilityRole="button" accessibilityLabel={t('help.close')} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
              <Text style={styles.title} accessibilityRole="header">
                {t('help.callbackOption')}
              </Text>
              <Text style={styles.question}>{t('help.phoneLabel')}</Text>
              <View style={styles.phoneRow}>
                <CountryCodePicker value={country} onChange={setCountry} />
                <View style={styles.flex}>
                  <AuthTextInput
                    variant="card"
                    value={phone}
                    onChangeText={(text) => {
                      setPhone(text);
                      setErrorKey(null);
                    }}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                    accessibilityLabel={t('help.phoneLabel')}
                    placeholder={t('help.phonePlaceholder')}
                  />
                </View>
              </View>

              <Text style={styles.question}>{t('help.whenLabel')}</Text>
              <View style={styles.chips}>
                <Pressable
                  onPress={() => setSlot(null)}
                  style={[styles.chip, slot == null && styles.chipSelected]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: slot == null }}
                >
                  <Text style={styles.chipText}>{t('help.asap')}</Text>
                </Pressable>
              </View>
              {(['today', 'tomorrow'] as const).map((day) => {
                const slots = info.callbackSlots.filter((s) => s.day === day);
                if (!slots.length) return null;
                return (
                  <View key={day}>
                    <Text style={styles.dayLabel}>{t(`help.${day}`)}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slotRow}>
                      {slots.map((s) => (
                        <Pressable
                          key={s.at}
                          onPress={() => setSlot(s)}
                          style={[styles.chip, slot?.at === s.at && styles.chipSelected]}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: slot?.at === s.at }}
                          accessibilityLabel={`${t(`help.${day}`)} ${s.time}`}
                        >
                          <Text style={styles.chipText}>{s.time}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                );
              })}
              <Text style={styles.notice}>{t('help.barcelonaTime')}</Text>

              <Pressable
                onPress={() => {
                  setConsent((value) => !value);
                  setErrorKey(null);
                }}
                style={styles.consentRow}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: consent }}
              >
                <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={24} color={consent ? colors.accentPrimaryStrong : colors.textSecondary} />
                <Text style={styles.consentText}>{t('help.consent')}</Text>
              </Pressable>

              {errorKey ? <ErrorNotice message={t(errorKey)} /> : null}
              <PrimaryButton label={t('help.requestCallback')} onPress={() => submit('callback')} loading={busy} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  box: {
    marginTop: spacing.x3,
    padding: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
  },
  title: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  question: {
    ...baseText.body,
    fontWeight: '600',
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  notice: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginVertical: spacing.x2,
  },
  warning: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginTop: spacing.x3,
  },
  chosen: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  slotRow: {
    gap: spacing.x2,
    paddingBottom: spacing.x2,
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.x4,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
  },
  chipSelected: {
    borderColor: colors.accentPrimaryStrong,
    backgroundColor: colors.accentPrimarySoft,
  },
  chipText: {
    ...baseText.bodySmall,
    fontWeight: '600',
  },
  options: {
    gap: spacing.x3,
  },
  option: {
    padding: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCardSolid,
    gap: spacing.x1,
  },
  optionDisabled: {
    opacity: 0.6,
  },
  optionTitle: {
    ...baseText.body,
    fontWeight: '700',
  },
  optionText: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  backdrop: {
    backgroundColor: overlays.scrimMedium,
  },
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: colors.bgElevated,
    borderTopWidth: borders.regular,
    borderColor: colors.borderSubtle,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderSubtle,
    marginTop: spacing.x2,
  },
  sheetContent: {
    padding: spacing.x6,
    paddingBottom: spacing.x8,
  },
  dayLabel: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: spacing.x2,
    alignItems: 'flex-start',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  consentText: {
    ...baseText.bodySmall,
    flex: 1,
  },
});
