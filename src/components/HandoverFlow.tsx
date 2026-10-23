import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { CountryCode } from 'libphonenumber-js';

import {
  CallbackSlot,
  createSupportTicket,
  CreatedTicket,
  fetchSupportInfo,
  HelpLanguage,
  SupportInfo,
} from '../services/helpChat';
import { toE164 } from '../services/phoneRules';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import { barcelonaDateParts, barcelonaWeekday } from '../utils/formatDateTime';
import AuthTextInput from './AuthTextInput';
import Card from './Card';
import CountryCodePicker from './CountryCodePicker';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';
import Skeleton from './Skeleton';

type Props = {
  conversationId: string;
  // Why it goes to a person: "Talk to a person", "No", or the assistant's own handover rules.
  reason: string;
  appLanguage: HelpLanguage;
  // After "We tried to call you": choose WhatsApp or another call back for the same ticket.
  changeChannel?: boolean;
  // A ticket was created or changed.
  onDone?: () => void;
};

type Step = 'language' | 'channel' | 'callback' | 'done';

const TICKET_ERRORS: Record<string, string> = {
  invalid_phone: 'help.phoneInvalid',
  consent_required: 'help.consentRequired',
  invalid_callback_time: 'help.slotGone',
  whatsapp_unavailable: 'help.whatsappUnavailable',
};

// The handover to the FLOQQ team, inside the help chat: which language, then WhatsApp (a message
// with only the ticket reference) or a call back (number, time, consent). Outside support hours
// the passenger first sees when the team is back; after danger, "call 112" always comes first.
export default function HandoverFlow({ conversationId, reason, appLanguage, changeChannel = false, onDone }: Props) {
  const { t, i18n } = useTranslation();
  const [info, setInfo] = useState<SupportInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [step, setStep] = useState<Step>(changeChannel ? 'channel' : 'language');
  const [language, setLanguage] = useState<HelpLanguage>(appLanguage);
  const [country, setCountry] = useState<CountryCode>('ES');
  const [phone, setPhone] = useState('');
  const [slot, setSlot] = useState<CallbackSlot | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [ticket, setTicket] = useState<CreatedTicket | null>(null);
  const [whatsappFailed, setWhatsappFailed] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const { info: next, error } = await fetchSupportInfo(conversationId);
    if (error || !next) {
      setLoadFailed(true);
      return;
    }
    setInfo(next);
    if (!next.teamLanguages.includes(appLanguage)) setLanguage(next.teamLanguages[0]);
    if (next.existingTicket && !changeChannel) {
      setTicket({
        reference: next.existingTicket.reference,
        channel: next.existingTicket.channel,
        callbackAt: next.existingTicket.callback_at,
        urgent: false,
        whatsapp: null,
      });
      setStep('done');
    }
  }, [conversationId, appLanguage, changeChannel]);

  useEffect(() => {
    load();
  }, [load]);

  const openWhatsApp = async (created: CreatedTicket) => {
    if (!created.whatsapp) return;
    try {
      await Linking.openURL(`whatsapp://send?phone=${created.whatsapp.digits}&text=${encodeURIComponent(created.whatsapp.text)}`);
      setWhatsappFailed(false);
    } catch {
      // No WhatsApp on this phone: offer the call back instead.
      setWhatsappFailed(true);
    }
  };

  const submit = async (channel: 'whatsapp' | 'callback') => {
    setErrorKey(null);
    let e164: string | undefined;
    if (channel === 'callback') {
      e164 = toE164(country, phone) ?? undefined;
      if (!e164) return setErrorKey('help.phoneInvalid');
      if (!consent) return setErrorKey('help.consentRequired');
    }
    setBusy(true);
    const { ticket: created, error } = await createSupportTicket({
      conversationId,
      reason,
      language,
      channel,
      ...(channel === 'callback' ? { phone: e164, callbackAt: slot?.at ?? null, consent } : {}),
    });
    setBusy(false);
    if (error || !created) {
      setErrorKey(TICKET_ERRORS[error ?? ''] ?? 'help.ticketError');
      return;
    }
    setTicket(created);
    setStep('done');
    onDone?.();
    if (created.channel === 'whatsapp') await openWhatsApp(created);
  };

  const when = (iso: string) => {
    const { hour, minute } = barcelonaDateParts(iso);
    return t('help.weekdayTime', { weekday: barcelonaWeekday(iso, i18n.language), time: `${hour}:${minute}` });
  };

  if (loadFailed) {
    return <ErrorNotice message={t('help.handoverLoadError')} onRetry={load} retryLabel={t('common.retry')} />;
  }
  if (!info) {
    return (
      <Card style={styles.card} accessible accessibilityLabel={t('admin.loading')}>
        <Skeleton width={200} height={18} style={styles.gap} />
        <Skeleton width={240} height={14} />
      </Card>
    );
  }

  const emergencyBanner = info.emergency ? (
    <View style={styles.emergency}>
      <Text style={styles.emergencyText}>{t('help.emergencyFirst')}</Text>
      <SecondaryButton label={t('help.call112')} icon="call" onPress={() => Linking.openURL('tel:112')} />
    </View>
  ) : null;

  const hoursNotice = !info.openNow ? (
    <Text style={styles.notice} accessibilityLiveRegion="polite">
      {info.nextOpenAt ? t('help.outsideHours', { when: when(info.nextOpenAt) }) : t('help.noHours')}
    </Text>
  ) : null;

  if (step === 'done' && ticket) {
    const slotTime = ticket.callbackAt ? barcelonaDateParts(ticket.callbackAt) : null;
    return (
      <Card style={styles.card}>
        {emergencyBanner}
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Text style={styles.title} accessibilityLiveRegion="polite">
            {t('help.ticketCreated', { reference: ticket.reference })}
          </Text>
        </View>
        {ticket.channel === 'whatsapp' ? (
          <>
            {whatsappFailed ? (
              <>
                <Text style={styles.warning}>{t('help.whatsappNotInstalled')}</Text>
                <SecondaryButton
                  label={t('help.callbackOption')}
                  onPress={() => {
                    setWhatsappFailed(false);
                    setStep('callback');
                  }}
                />
              </>
            ) : (
              <>
                <Text style={styles.body}>{t('help.whatsappDone', { reference: ticket.reference })}</Text>
                {ticket.whatsapp ? <SecondaryButton label={t('help.openWhatsAppAgain')} icon="logo-whatsapp" onPress={() => openWhatsApp(ticket)} /> : null}
              </>
            )}
          </>
        ) : (
          <Text style={styles.body}>
            {slotTime && ticket.callbackAt
              ? t('help.callbackDoneAt', { when: when(ticket.callbackAt), reference: ticket.reference })
              : info.openNow
                ? t('help.callbackDoneAsap', { reference: ticket.reference })
                : t('help.callbackDoneAsapClosed', { when: info.nextOpenAt ? when(info.nextOpenAt) : '', reference: ticket.reference })}
          </Text>
        )}
        <Text style={styles.notice}>{t('help.teamWillFollowUp')}</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        {t('help.handoverTitle')}
      </Text>
      {emergencyBanner}
      {hoursNotice}

      {step === 'language' ? (
        <>
          <Text style={styles.question}>{t('help.languageQuestion')}</Text>
          <View style={styles.chips}>
            {info.teamLanguages.map((code) => (
              <Pressable
                key={code}
                onPress={() => setLanguage(code)}
                style={[styles.chip, language === code && styles.chipSelected]}
                accessibilityRole="radio"
                accessibilityState={{ checked: language === code }}
              >
                <Text style={styles.chipText}>{t(`help.languageName.${code}`)}</Text>
              </Pressable>
            ))}
          </View>
          <PrimaryButton label={t('help.continue')} onPress={() => setStep('channel')} />
        </>
      ) : step === 'channel' ? (
        <>
          <Text style={styles.question}>{t('help.channelQuestion')}</Text>
          {errorKey ? <ErrorNotice message={t(errorKey)} /> : null}
          <View style={styles.actions}>
            {/* Always shown; until the team's WhatsApp number is set it can't be used yet. */}
            <PrimaryButton label={t('help.whatsappOption')} onPress={() => submit('whatsapp')} loading={busy} disabled={!info.whatsapp} />
            {!info.whatsapp ? <Text style={styles.notice}>{t('help.whatsappComingSoon')}</Text> : null}
            <SecondaryButton label={t('help.callbackOption')} icon="call-outline" onPress={() => setStep('callback')} disabled={busy} />
            {!changeChannel ? <SecondaryButton label={t('help.back')} onPress={() => setStep('language')} disabled={busy} /> : null}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.question}>{t('help.phoneLabel')}</Text>
          <View style={styles.phoneRow}>
            <CountryCodePicker value={country} onChange={setCountry} />
            <View style={styles.phoneInput}>
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
                <View style={styles.chips}>
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
                </View>
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
          <View style={styles.actions}>
            <PrimaryButton label={t('help.requestCallback')} onPress={() => submit('callback')} loading={busy} />
            <SecondaryButton label={t('help.back')} onPress={() => setStep(ticket ? 'done' : 'channel')} disabled={busy} />
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.x3,
  },
  gap: {
    marginBottom: spacing.x2,
  },
  title: {
    ...baseText.h3,
    flexShrink: 1,
    marginBottom: spacing.x2,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  question: {
    ...baseText.body,
    fontWeight: '600',
    marginTop: spacing.x3,
    marginBottom: spacing.x2,
  },
  body: {
    ...baseText.body,
    marginBottom: spacing.x3,
  },
  notice: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  warning: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginBottom: spacing.x3,
  },
  emergency: {
    padding: spacing.x3,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
    marginBottom: spacing.x3,
    gap: spacing.x2,
  },
  emergencyText: {
    ...baseText.body,
    color: colors.dangerStrong,
    fontWeight: '700',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginBottom: spacing.x3,
  },
  chip: {
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x3,
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
  dayLabel: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
  phoneRow: {
    flexDirection: 'row',
    gap: spacing.x2,
    alignItems: 'flex-start',
  },
  phoneInput: {
    flex: 1,
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
  actions: {
    gap: spacing.x2,
  },
});
