import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ticketStatusPill } from '../components/AdminSupportInbox';
import AuthTextInput from '../components/AuthTextInput';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import StatusPill from '../components/StatusPill';
import { formatCents } from '../services/payments';
import {
  CALL_LATER_MINUTES,
  ConversationMessage,
  fetchConversation,
  fetchTicket,
  fetchTicketEvents,
  fetchTicketRide,
  RESOLUTION_CATEGORIES,
  ResolutionCategory,
  runTicketAction,
  SupportTicket,
  TicketActionRequest,
  TicketEvent,
  TicketRide,
} from '../services/supportInbox';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';

type Props = {
  ticketId: string;
  onBack: () => void;
};

const ACTION_ERRORS: Record<string, string> = {
  changed_meanwhile: 'adminSupport.changedMeanwhile',
  already_resolved: 'adminSupport.alreadyResolved',
  invalid_note: 'adminSupport.noteInvalid',
};

// Admin: one support ticket - the summary, the passenger's whole conversation with the assistant,
// their ride and payment (read-only), how they want to be reached, internal notes, and the actions:
// call back outcomes, "In progress", and "Resolve" with a category.
export default function SupportTicketScreen({ ticketId, onBack }: Props) {
  const { t } = useTranslation();
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [ride, setRide] = useState<TicketRide | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Picking a category for "Called - resolved" or "Resolve".
  const [resolving, setResolving] = useState<'called_resolved' | 'resolve' | null>(null);
  const [category, setCategory] = useState<ResolutionCategory | null>(null);
  const [laterOpen, setLaterOpen] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await fetchTicket(ticketId);
    if (error || !data) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setTicket(data);
    const [conversation, history, rideFacts] = await Promise.all([
      data.conversation_id ? fetchConversation(data.conversation_id) : Promise.resolve({ data: [] as ConversationMessage[] }),
      fetchTicketEvents(data.id),
      data.request_id ? fetchTicketRide(data.request_id) : Promise.resolve(null),
    ]);
    setMessages(conversation.data ?? []);
    setEvents(history.data ?? []);
    setRide(rideFacts);
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (request: TicketActionRequest) => {
    if (!ticket) return;
    setErrorKey(null);
    setBusy(request.action);
    const { error } = await runTicketAction(ticket.id, request);
    setBusy(null);
    if (error) {
      setErrorKey(ACTION_ERRORS[error] ?? 'adminSupport.actionError');
      if (error === 'changed_meanwhile') load();
      return;
    }
    setResolving(null);
    setCategory(null);
    setLaterOpen(false);
    if (request.action === 'note') setNote('');
    load();
  };

  const openWhatsApp = async () => {
    try {
      await Linking.openURL('whatsapp://');
    } catch {
      await Linking.openURL('https://web.whatsapp.com/');
    }
  };

  if (loadFailed) {
    return (
      <View style={styles.centered}>
        <ErrorNotice message={t('adminSupport.ticketLoadError')} onRetry={load} retryLabel={t('common.retry')} />
      </View>
    );
  }

  const isOpen = ticket != null && ticket.status !== 'resolved';
  const isCallback = ticket?.channel === 'callback';

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={t('admin.back')}>
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>

        {ticket ? (
          <>
            <View style={styles.titleRow}>
              <Text style={styles.title} accessibilityRole="header">
                #{ticket.reference}
              </Text>
              {ticket.urgent ? (
                <View style={styles.urgentBadge}>
                  <Text style={styles.urgentText}>{t('adminSupport.urgentLong')}</Text>
                </View>
              ) : null}
            </View>
            <StatusPill
              status={ticketStatusPill(ticket.status)}
              label={ticket.resolution_category === 'closed_by_user' ? t('adminSupport.closedByUser') : t(`adminSupport.status.${ticket.status}`)}
            />
            <Text style={styles.meta}>
              {t('adminSupport.openedAt', { when: formatBarcelonaDateTime(ticket.created_at) })} ·{' '}
              {t(`adminSupport.reason.${ticket.category}`, { defaultValue: ticket.category })} · {ticket.language.toUpperCase()}
            </Text>
            {ticket.resolution_category ? (
              <Text style={styles.meta}>
                {t('adminSupport.resolvedAs', {
                  category: t(`adminSupport.category.${ticket.resolution_category}`),
                  when: ticket.resolved_at ? formatBarcelonaDateTime(ticket.resolved_at) : '',
                })}
              </Text>
            ) : null}

            {errorKey ? <ErrorNotice message={t(errorKey)} /> : null}

            <Card style={styles.card}>
              <Text style={styles.cardTitle}>{t('adminSupport.summaryTitle')}</Text>
              <Text style={styles.body} selectable>
                {ticket.summary ?? t('adminSupport.noSummary')}
              </Text>
            </Card>

            <Card style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name={isCallback ? 'call-outline' : 'logo-whatsapp'} size={20} color={colors.textPrimary} />
                <Text style={styles.cardTitle}>{t(`adminSupport.channel.${ticket.channel}`)}</Text>
              </View>
              {isCallback ? (
                <>
                  <Text style={styles.phone} selectable>
                    {ticket.callback_phone}
                  </Text>
                  <Text style={styles.meta}>
                    {ticket.callback_at ? t('adminSupport.callAt', { when: formatBarcelonaDateTime(ticket.callback_at) }) : t('adminSupport.callAsap')}
                  </Text>
                  {ticket.call_attempts > 0 ? (
                    <Text style={styles.meta}>
                      {t('adminSupport.callAttempts', {
                        count: ticket.call_attempts,
                        when: ticket.last_call_at ? formatBarcelonaDateTime(ticket.last_call_at) : '',
                      })}
                    </Text>
                  ) : null}
                  {ticket.callback_phone ? (
                    <View style={styles.actions}>
                      <PrimaryButton label={t('adminSupport.callNow')} onPress={() => Linking.openURL(`tel:${ticket.callback_phone}`)} />
                    </View>
                  ) : null}
                  {isOpen ? (
                    <View style={styles.actions}>
                      <SecondaryButton label={t('adminSupport.calledResolved')} icon="checkmark-circle-outline" onPress={() => setResolving('called_resolved')} disabled={busy != null} />
                      <SecondaryButton label={t('adminSupport.noAnswer')} icon="call-outline" onPress={() => act({ action: 'no_answer' })} loading={busy === 'no_answer'} disabled={busy != null} />
                      <SecondaryButton label={t('adminSupport.callLater')} icon="time-outline" onPress={() => setLaterOpen((open) => !open)} disabled={busy != null} />
                      {laterOpen ? (
                        <View style={styles.chips}>
                          {CALL_LATER_MINUTES.map((minutes) => (
                            <Pressable key={minutes} onPress={() => act({ action: 'call_later', minutes })} style={styles.chip} accessibilityRole="button">
                              <Text style={styles.chipText}>{t('adminSupport.inMinutes', { count: minutes })}</Text>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.body}>{t('adminSupport.whatsappHint', { reference: ticket.reference })}</Text>
                  <View style={styles.actions}>
                    <PrimaryButton label={t('adminSupport.openWhatsApp')} onPress={openWhatsApp} />
                  </View>
                </>
              )}
              {isOpen && ticket.status !== 'in_progress' ? (
                <View style={styles.actions}>
                  <SecondaryButton label={t('adminSupport.markInProgress')} onPress={() => act({ action: 'in_progress' })} loading={busy === 'in_progress'} disabled={busy != null} />
                </View>
              ) : null}
            </Card>

            {isOpen ? (
              <Card style={styles.card}>
                <Text style={styles.cardTitle}>{t('adminSupport.resolveTitle')}</Text>
                <View style={styles.chips}>
                  {RESOLUTION_CATEGORIES.map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => {
                        setCategory(value);
                        if (!resolving) setResolving('resolve');
                      }}
                      style={[styles.chip, category === value && styles.chipSelected]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: category === value }}
                    >
                      <Text style={styles.chipText}>{t(`adminSupport.category.${value}`)}</Text>
                    </Pressable>
                  ))}
                </View>
                {resolving === 'called_resolved' ? <Text style={styles.meta}>{t('adminSupport.calledResolvedHint')}</Text> : null}
                <PrimaryButton
                  label={t(resolving === 'called_resolved' ? 'adminSupport.calledResolved' : 'adminSupport.resolve')}
                  onPress={() => category && act({ action: resolving === 'called_resolved' ? 'called_resolved' : 'resolve', category })}
                  disabled={!category || busy != null}
                  loading={busy === 'resolve' || busy === 'called_resolved'}
                />
              </Card>
            ) : null}

            {ride ? (
              <Card style={styles.card}>
                <Text style={styles.cardTitle}>{t('adminSupport.rideTitle')}</Text>
                {ride.passengerName ? <Text style={styles.body}>{ride.passengerName}</Text> : null}
                <Text style={styles.meta}>
                  {[ride.flight, ride.terminal, formatBarcelonaDateTime(ride.arrivalAt)].filter(Boolean).join(' · ')}
                </Text>
                <Text style={styles.meta}>{ride.destination}</Text>
                <Text style={styles.meta}>
                  {t('adminSupport.rideStatus', { status: ride.completedAt ? t('adminSupport.rideCompleted') : ride.status })}
                </Text>
                {ride.group ? (
                  <Text style={styles.meta}>
                    {t('adminSupport.groupLine', {
                      status: ride.group.status,
                      point: ride.group.meetingPoint ?? '-',
                      time: ride.group.meetingTime ? formatBarcelonaDateTime(ride.group.meetingTime) : '-',
                    })}
                    {ride.group.rideStartedAt ? ` · ${t('adminSupport.onTheWay')}` : ''}
                    {ride.group.isPayer ? ` · ${t('adminSupport.payer')}` : ''}
                  </Text>
                ) : null}
                {ride.payment ? (
                  <Text style={styles.meta}>
                    {t('adminSupport.paymentLine', {
                      status: ride.payment.status,
                      held: ride.payment.holdCents != null ? `€${formatCents(ride.payment.holdCents)}` : '-',
                      charged: ride.payment.capturedCents != null ? `€${formatCents(ride.payment.capturedCents)}` : '-',
                      released: ride.payment.releasedCents != null ? `€${formatCents(ride.payment.releasedCents)}` : '-',
                    })}
                    {ride.payment.failure ? ` · ${ride.payment.failure}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.meta}>{t('adminSupport.noPayment')}</Text>
                )}
              </Card>
            ) : null}

            <Card style={styles.card}>
              <Text style={styles.cardTitle}>{t('adminSupport.conversationTitle')}</Text>
              {messages.length === 0 ? <Text style={styles.meta}>{t('adminSupport.noConversation')}</Text> : null}
              {messages.map((message) => (
                <View key={message.id} style={styles.message}>
                  <Text style={styles.messageWho}>
                    {t(message.role === 'user' ? 'adminSupport.passenger' : 'adminSupport.assistant')} · {formatBarcelonaDateTime(message.created_at)}
                  </Text>
                  <Text style={styles.body} selectable>
                    {message.content}
                  </Text>
                </View>
              ))}
            </Card>

            <Card style={styles.card}>
              <Text style={styles.cardTitle}>{t('adminSupport.historyTitle')}</Text>
              {events.length === 0 ? <Text style={styles.meta}>{t('adminSupport.historyEmpty')}</Text> : null}
              {events.map((event) => (
                <View key={event.id} style={styles.message}>
                  <Text style={styles.messageWho}>
                    {t(`adminSupport.event.${event.kind}`, { defaultValue: event.kind })} · {formatBarcelonaDateTime(event.created_at)}
                  </Text>
                  {event.body ? (
                    <Text style={styles.body} selectable>
                      {event.kind === 'resolved' || event.kind === 'called_resolved'
                        ? t(`adminSupport.category.${event.body}`, { defaultValue: event.body })
                        : event.body}
                    </Text>
                  ) : null}
                </View>
              ))}
              <AuthTextInput
                variant="card"
                value={note}
                onChangeText={setNote}
                placeholder={t('adminSupport.notePlaceholder')}
                accessibilityLabel={t('adminSupport.notePlaceholder')}
                multiline
                maxLength={2000}
                style={styles.noteInput}
              />
              <SecondaryButton label={t('adminSupport.addNote')} onPress={() => act({ action: 'note', body: note })} disabled={!note.trim() || busy != null} loading={busy === 'note'} />
              <Text style={styles.meta}>{t('adminSupport.notesPrivate')}</Text>
            </Card>
          </>
        ) : (
          <Text style={styles.meta}>{t('admin.loading')}</Text>
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.x6,
    backgroundColor: colors.bgPrimary,
  },
  backText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginBottom: spacing.x3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  title: {
    ...baseText.h2,
  },
  urgentBadge: {
    paddingVertical: spacing.x1,
    paddingHorizontal: spacing.x2,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
  },
  urgentText: {
    ...baseText.caption,
    color: colors.dangerStrong,
    fontWeight: '700',
  },
  meta: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: spacing.x1,
  },
  card: {
    marginTop: spacing.x4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  cardTitle: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  body: {
    ...baseText.body,
  },
  phone: {
    ...baseText.h3,
    letterSpacing: 0.5,
  },
  actions: {
    gap: spacing.x2,
    marginTop: spacing.x3,
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
  message: {
    paddingVertical: spacing.x2,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.borderSubtle,
  },
  messageWho: {
    ...baseText.caption,
    color: colors.info,
    marginBottom: spacing.x1,
  },
  noteInput: {
    minHeight: 80,
    paddingVertical: spacing.x3,
  },
});
