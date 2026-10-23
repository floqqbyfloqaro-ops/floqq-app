import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import HandoverFlow from '../components/HandoverFlow';
import HelpMessageText from '../components/HelpMessageText';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import { HELP_MAX_MESSAGE_CHARS } from '../constants';
import { helpLanguageFor, HelpMessage, markHelpResolved, sendHelpMessage, startHelpConversation } from '../services/helpChat';
import { fetchMyLatestTicket, MyTicket } from '../services/supportInbox';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';
import { barcelonaDateParts, barcelonaWeekday } from '../utils/formatDateTime';

// What the passenger sees about their ticket: when the team will call, that they tried, or that
// it is resolved.
function ticketStatusText(ticket: MyTicket, t: TFunction, language: string): string {
  const reference = ticket.reference;
  if (ticket.status === 'resolved') return t('help.ticketResolved', { reference });
  if (ticket.status === 'no_answer') return t('help.ticketNoAnswer', { reference });
  if (ticket.channel === 'whatsapp') return t('help.ticketWaitingWhatsApp', { reference });
  if (ticket.callback_at) {
    const { hour, minute } = barcelonaDateParts(ticket.callback_at);
    return t('help.ticketCallAt', { when: t('help.weekdayTime', { weekday: barcelonaWeekday(ticket.callback_at, language), time: `${hour}:${minute}` }), reference });
  }
  return ticket.status === 'in_progress' ? t('help.ticketInProgress', { reference }) : t('help.ticketCallAsap', { reference });
}

type Props = {
  onBack: () => void;
};

const SEND_ERRORS: Record<string, string> = {
  rate_limited: 'help.rateLimited',
  message_too_long: 'help.tooLong',
  assistant_unavailable: 'help.unavailable',
};

// "Help": the AI support assistant. It opens with the fixed "I'm an AI assistant" greeting; after
// a complete answer it asks "Did this solve your problem?"; "No", "Talk to a person" (always
// there) or the assistant's own handover rules lead to the FLOQQ team (HandoverFlow).
export default function HelpScreen({ onBack }: Props) {
  const { t, i18n } = useTranslation();
  const language = helpLanguageFor(i18n.language);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [startFailed, setStartFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // The answer whose "Did this solve your problem?" is waiting, and what came of it.
  const [checkFor, setCheckFor] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [handoverReason, setHandoverReason] = useState<string | null>(null);
  // The passenger's own latest ticket, and whether they are choosing a new way to be reached.
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [changingChannel, setChangingChannel] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const loadTicket = useCallback(async () => {
    setTicket(await fetchMyLatestTicket());
  }, []);

  const start = useCallback(async () => {
    setStartFailed(false);
    // With a ticket still open this is that ticket's conversation, so the team reads what follows.
    const { conversationId: id, messages: first, error } = await startHelpConversation(language);
    if (error || !id) {
      setStartFailed(true);
      return;
    }
    setConversationId(id);
    setMessages(first);
    loadTicket();
  }, [language, loadTicket]);

  useEffect(() => {
    start();
  }, [start]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !conversationId || sending) return;
    setSendError(null);
    setSending(true);
    setCheckFor(null);
    const pending: HelpMessage = { id: `pending-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages((current) => [...current, pending]);
    setDraft('');
    const { answer, error } = await sendHelpMessage(conversationId, text, language);
    setSending(false);
    if (error || !answer) {
      // Not sent: take it back out and put the text back, so nothing is lost.
      setMessages((current) => current.filter((m) => m.id !== pending.id));
      setDraft(text);
      setSendError(t(SEND_ERRORS[error ?? ''] ?? 'help.sendError', { max: HELP_MAX_MESSAGE_CHARS }));
      return;
    }
    setMessages((current) => [...current, answer.message]);
    setResolved(false);
    if (answer.handoverReason && !handoverReason) setHandoverReason(answer.handoverReason);
    else if (answer.resolutionCheck) setCheckFor(answer.message.id);
  };

  // A ticket the team is still handling: no second handover, the banner says what happens next.
  // The flow that just created it stays on screen with its confirmation.
  const openTicket = ticket != null && ticket.status !== 'resolved' && handoverReason == null;

  const answerCheck = async (solved: boolean) => {
    if (!conversationId) return;
    setCheckFor(null);
    if (solved) {
      setResolved(true);
      await markHelpResolved(conversationId);
    } else {
      setHandoverReason('not_solved');
    }
  };

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('admin.back')}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {t('help.title')}
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {startFailed ? <ErrorNotice message={t('help.startError')} onRetry={start} retryLabel={t('common.retry')} /> : null}

          {ticket ? (
            <Card style={styles.ticket}>
              <View style={styles.ticketRow}>
                <Ionicons
                  name={ticket.status === 'resolved' ? 'checkmark-circle' : ticket.status === 'no_answer' ? 'call-outline' : 'time-outline'}
                  size={20}
                  color={ticket.status === 'resolved' ? colors.success : ticket.status === 'no_answer' ? colors.warning : colors.info}
                />
                <Text style={styles.ticketText} accessibilityLiveRegion="polite">
                  {ticketStatusText(ticket, t, i18n.language)}
                </Text>
              </View>
              {ticket.status === 'no_answer' && !changingChannel ? (
                <SecondaryButton label={t('help.chooseHowToReach')} onPress={() => setChangingChannel(true)} />
              ) : null}
            </Card>
          ) : null}
          {changingChannel && conversationId ? (
            <HandoverFlow
              conversationId={conversationId}
              reason="user_asked"
              appLanguage={language}
              changeChannel
              onDone={() => {
                setChangingChannel(false);
                loadTicket();
              }}
            />
          ) : null}
          {!conversationId && !startFailed ? <ActivityIndicator color={colors.accentPrimaryStrong} accessibilityLabel={t('admin.loading')} /> : null}

          {messages.map((message) => (
            <View key={message.id} style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
              {message.role === 'assistant' ? (
                <HelpMessageText text={message.content} style={styles.bubbleText} />
              ) : (
                <Text style={styles.bubbleText} selectable>
                  {message.content}
                </Text>
              )}
            </View>
          ))}

          {sending ? (
            <View style={[styles.bubble, styles.assistantBubble]}>
              <Text style={styles.typing} accessibilityLiveRegion="polite">
                {t('help.typing')}
              </Text>
            </View>
          ) : null}

          {checkFor && !handoverReason ? (
            <Card style={styles.check}>
              <Text style={styles.checkQuestion}>{t('help_resolved_question')}</Text>
              <View style={styles.checkButtons}>
                <View style={styles.flex}>
                  <SecondaryButton label={t('help.yes')} icon="thumbs-up-outline" onPress={() => answerCheck(true)} />
                </View>
                <View style={styles.flex}>
                  <SecondaryButton label={t('help.no')} icon="thumbs-down-outline" onPress={() => answerCheck(false)} />
                </View>
              </View>
            </Card>
          ) : null}
          {resolved ? (
            <Text style={styles.glad} accessibilityLiveRegion="polite">
              {t('help.gladWeHelped')}
            </Text>
          ) : null}

          {handoverReason && conversationId && !openTicket ? (
            <HandoverFlow conversationId={conversationId} reason={handoverReason} appLanguage={language} onDone={loadTicket} />
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {sendError ? <ErrorNotice message={sendError} /> : null}
          {!handoverReason && !openTicket && conversationId ? (
            <Pressable
              onPress={() => setHandoverReason('user_asked')}
              style={styles.person}
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="person-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.personText}>{t('help.talkToPerson')}</Text>
            </Pressable>
          ) : null}
          <View style={styles.inputRow}>
            <View style={styles.flex}>
              <AuthTextInput
                variant="card"
                value={draft}
                onChangeText={setDraft}
                placeholder={t('help.inputPlaceholder')}
                accessibilityLabel={t('help.inputPlaceholder')}
                maxLength={HELP_MAX_MESSAGE_CHARS}
                multiline
                editable={conversationId != null}
                style={styles.input}
              />
            </View>
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending || !conversationId}
              style={[styles.send, (!draft.trim() || sending || !conversationId) && styles.sendDisabled]}
              accessibilityRole="button"
              accessibilityLabel={t('help.send')}
            >
              <Ionicons name="send" size={20} color={colors.white} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x3,
  },
  title: {
    ...baseText.h2,
  },
  content: {
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x6,
    gap: spacing.x2,
  },
  bubble: {
    maxWidth: '86%',
    paddingVertical: spacing.x3,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.lg,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceCardSolid,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentPrimary,
  },
  bubbleText: {
    ...baseText.body,
  },
  typing: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
  },
  check: {
    marginTop: spacing.x2,
  },
  ticket: {
    marginBottom: spacing.x2,
    gap: spacing.x3,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  ticketText: {
    ...baseText.body,
    flex: 1,
  },
  checkQuestion: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x3,
  },
  checkButtons: {
    flexDirection: 'row',
    gap: spacing.x2,
  },
  glad: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.x2,
  },
  footer: {
    paddingHorizontal: spacing.x6,
    paddingTop: spacing.x2,
    paddingBottom: spacing.x6,
    backgroundColor: colors.bgPrimary,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.borderSubtle,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.x1,
    marginBottom: spacing.x2,
  },
  personText: {
    ...baseText.bodySmall,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x2,
  },
  input: {
    maxHeight: 120,
    paddingVertical: spacing.x3,
  },
  send: {
    width: 52,
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPrimary,
  },
  sendDisabled: {
    backgroundColor: colors.borderSubtle,
  },
});
