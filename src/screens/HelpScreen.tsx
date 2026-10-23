import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNetworkState } from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import ErrorNotice from '../components/ErrorNotice';
import HelpAvatar from '../components/HelpAvatar';
import HelpComposer from '../components/HelpComposer';
import HelpHandover from '../components/HelpHandover';
import HelpMessageRow from '../components/HelpMessageRow';
import HelpTicketCard from '../components/HelpTicketCard';
import SecondaryButton from '../components/SecondaryButton';
import StatusPill from '../components/StatusPill';
import {
  fetchHelpTopic,
  HelpAction,
  helpLanguageFor,
  HelpMessage,
  markHelpResolved,
  sendHelpFeedback,
  sendHelpMessageStreamed,
  startHelpConversation,
} from '../services/helpChat';
import { chipsFor, HelpRideFacts, HelpTopic, rideStage, stagePill } from '../services/helpChips';
import { plainText } from '../services/helpMarkdown';
import { fetchMyGroupStatus, fetchMyLatestRequest, MyPassengerRequest } from '../services/passengerRequests';
import { supabase } from '../services/supabase';
import { fetchMyLatestTicket, fetchMyTickets, MyTicket } from '../services/supportInbox';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  onBack: () => void;
  // Where the answers' buttons lead. None of them changes anything by itself.
  onOpenMyRide: () => void;
  onEditRide: (requestId: string) => void;
  onOpenPaymentMethods: () => void;
  onShowBadge: () => void;
};

type Item =
  | { kind: 'message'; message: HelpMessage; firstInGroup: boolean; lastInGroup: boolean; streaming: boolean }
  | { kind: 'check' }
  | { kind: 'glad' }
  | { kind: 'offer' }
  | { kind: 'retry' }
  | { kind: 'handover' }
  | { kind: 'ticket' };

const SEND_ERRORS: Record<string, string> = {
  rate_limited: 'help.rateLimited',
  message_too_long: 'help.tooLong',
};

const TICKET_REFRESH_MS = 20_000;
const STREAMING_ID = 'streaming';

// "Help": the FLOQQ Assistant, a full-screen chat. It greets the passenger by name, knows their
// current ride (a context card, and suggested questions that follow the ride), streams its answers,
// shows the passenger's own data as cards and offers buttons to the right screen. "Did this solve
// your problem?", the handover to the team and the ticket all happen inside the conversation. Typed
// text is never lost, a message written offline goes out once the phone is back online, and when
// the assistant can't be reached the suggested questions still get the knowledge base's answer.
export default function HelpScreen({ onBack, onOpenMyRide, onEditRide, onOpenPaymentMethods, onShowBadge }: Props) {
  const { t, i18n } = useTranslation();
  const language = helpLanguageFor(i18n.language);
  const network = useNetworkState();
  const offline = network.isConnected === false || network.isInternetReachable === false;

  const [userId, setUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [startFailed, setStartFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [queued, setQueued] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [checkFor, setCheckFor] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [offerFor, setOfferFor] = useState<{ messageId: string; reason: string } | null>(null);
  const [handoverReason, setHandoverReason] = useState<string | null>(null);
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [changingChannel, setChangingChannel] = useState(false);
  const [ride, setRide] = useState<{ request: MyPassengerRequest; facts: HelpRideFacts } | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [requests, setRequests] = useState<MyTicket[]>([]);
  const listRef = useRef<FlatList<Item>>(null);
  const sendingRef = useRef(false);

  const draftKey = userId ? `help-draft:${userId}` : null;
  const queueKey = userId ? `help-queue:${userId}` : null;

  // --- Loading ---

  const loadTicket = useCallback(async () => setTicket(await fetchMyLatestTicket()), []);

  const loadRide = useCallback(async () => {
    const { data: request } = await fetchMyLatestRequest();
    if (!request) return setRide(null);
    const { data: group } = request.group_id ? await fetchMyGroupStatus(request.group_id) : { data: null };
    setRide({
      request,
      facts: {
        status: request.status,
        arrivalAt: request.arrival_at,
        readyAt: request.ready_at,
        completedAt: request.completed_at,
        groupStatus: group?.status ?? null,
        rideStartedAt: group?.ride_started_at ?? null,
      },
    });
  }, []);

  const start = useCallback(
    async (fresh = false) => {
      setStartFailed(false);
      setCheckFor(null);
      setResolved(false);
      setOfferFor(null);
      setHandoverReason(null);
      setSendError(null);
      setFailures(0);
      const result = await startHelpConversation(language, fresh);
      if (result.error || !result.conversationId) return setStartFailed(true);
      setConversationId(result.conversationId);
      setMessages(result.messages);
      setFirstName(result.firstName);
      loadTicket();
    },
    [language, loadTicket]
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    start();
    loadRide();
  }, [start, loadRide]);

  // What was typed (and a message waiting for the connection) survives leaving and coming back.
  useEffect(() => {
    if (!draftKey || !queueKey) return;
    (async () => {
      try {
        const [savedDraft, savedQueue] = await Promise.all([AsyncStorage.getItem(draftKey), AsyncStorage.getItem(queueKey)]);
        if (savedDraft) setDraft((current) => current || savedDraft);
        if (savedQueue) setQueued(savedQueue);
      } catch {
        // Storage unavailable: nothing to restore.
      }
    })();
  }, [draftKey, queueKey]);

  useEffect(() => {
    if (!draftKey) return;
    const timer = setTimeout(() => {
      (draft ? AsyncStorage.setItem(draftKey, draft) : AsyncStorage.removeItem(draftKey)).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, draftKey]);

  // The ticket card stays up to date while the ticket is open.
  useEffect(() => {
    if (!ticket || ticket.status === 'resolved') return;
    const timer = setInterval(loadTicket, TICKET_REFRESH_MS);
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && loadTicket());
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ticket, loadTicket]);

  // --- Sending ---

  const send = useCallback(
    async (text: string) => {
      if (!conversationId || sendingRef.current) return;
      sendingRef.current = true;
      setSendError(null);
      setCheckFor(null);
      setResolved(false);
      const local: HelpMessage = { id: `local-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() };
      const placeholder: HelpMessage = { id: STREAMING_ID, role: 'assistant', content: '', created_at: new Date().toISOString() };
      setMessages((current) => [...current, local, placeholder]);
      setStreaming(true);

      // Pieces of text are gathered and shown a few times a second, not one render per word.
      let buffered = '';
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        flushTimer = null;
        const text = buffered;
        setMessages((current) => current.map((m) => (m.id === STREAMING_ID ? { ...m, content: text } : m)));
      };

      const { answer, error } = await sendHelpMessageStreamed(conversationId, text, language, {
        onEmergency: () => setMessages((current) => current.map((m) => (m.id === STREAMING_ID ? { ...m, emergency: true } : m))),
        onText: (delta) => {
          buffered += delta;
          if (!flushTimer) flushTimer = setTimeout(flush, 80);
        },
        onReset: () => {
          buffered = '';
          if (!flushTimer) flushTimer = setTimeout(flush, 0);
        },
      });
      if (flushTimer) clearTimeout(flushTimer);
      setStreaming(false);
      sendingRef.current = false;

      if (answer) {
        setFailures(0);
        setMessages((current) => current.map((m) => (m.id === STREAMING_ID ? answer.message : m)));
        AccessibilityInfo.announceForAccessibility(plainText(answer.message.content));
        if (answer.handoverReason) setHandoverReason((reason) => reason ?? answer.handoverReason);
        else if (answer.offerHandover) setOfferFor({ messageId: answer.message.id, reason: answer.emergency ? 'safety' : 'user_asked' });
        else if (answer.resolutionCheck) setCheckFor(answer.message.id);
        return;
      }

      // Not answered: nothing is lost.
      setMessages((current) => current.filter((m) => m.id !== STREAMING_ID && m.id !== local.id));
      if (error === 'interrupted') {
        // The server still finished and stored it: show what it has.
        start();
        return;
      }
      if (error === 'offline') {
        setQueued(text);
        if (queueKey) AsyncStorage.setItem(queueKey, text).catch(() => {});
        return;
      }
      setDraft((current) => current || text);
      if (SEND_ERRORS[error ?? '']) {
        setSendError(t(SEND_ERRORS[error!], { max: 1000 }));
        return;
      }
      setFailures((count) => count + 1);
    },
    [conversationId, language, queueKey, start, t]
  );

  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (offline) {
      setQueued(text);
      if (queueKey) AsyncStorage.setItem(queueKey, text).catch(() => {});
      return;
    }
    send(text);
  };

  // Back online: the waiting message goes out by itself.
  useEffect(() => {
    if (offline || !queued || !conversationId || sendingRef.current) return;
    const text = queued;
    setQueued(null);
    if (queueKey) AsyncStorage.removeItem(queueKey).catch(() => {});
    send(text);
  }, [offline, queued, conversationId, queueKey, send]);

  const retry = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    send(text);
  };

  // Suggested questions: asked like any message - or, when the assistant can't be reached, answered
  // straight from the knowledge base.
  const askTopic = async (topic: HelpTopic) => {
    const question = t(`help.chip.${topic}`);
    if (failures < 2) return send(question);
    const { article } = await fetchHelpTopic(topic, language);
    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: `topic-q-${Date.now()}`, role: 'user', content: question, created_at: now },
      { id: `topic-a-${Date.now()}`, role: 'assistant', content: article ? `**${article.title}**\n\n${article.content}` : t('help.unavailable'), created_at: now },
    ]);
  };

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

  const onAction = (action: HelpAction) => {
    if (action === 'open_my_ride' || action === 'cancel_ride') onOpenMyRide();
    else if (action === 'edit_ride') ride ? onEditRide(ride.request.id) : onOpenMyRide();
    else if (action === 'payment_methods') onOpenPaymentMethods();
    else if (action === 'show_badge') onShowBadge();
    else if (action === 'location_settings') Linking.openSettings().catch(() => {});
  };

  const onFeedback = useCallback((messageId: string, value: 'up' | 'down' | null, note?: string) => {
    if (messageId === STREAMING_ID || messageId.startsWith('local-') || messageId.startsWith('topic-')) return;
    sendHelpFeedback(messageId, value, note);
  }, []);

  const openRequests = async () => {
    setRequestsOpen(true);
    setRequests(await fetchMyTickets());
  };

  // --- What the list shows ---

  const openTicket = ticket != null && ticket.status !== 'resolved';
  const showTicket = ticket != null && (openTicket || ticket.conversation_id === conversationId);
  const items = useMemo<Item[]>(() => {
    const list: Item[] = messages.map((message, index) => ({
      kind: 'message',
      message,
      firstInGroup: index === 0 || messages[index - 1].role !== message.role,
      lastInGroup: index === messages.length - 1 || messages[index + 1].role !== message.role,
      streaming: message.id === STREAMING_ID,
    }));
    if (failures > 0 && !streaming) list.push({ kind: 'retry' });
    if (checkFor && !handoverReason && !openTicket) list.push({ kind: 'check' });
    if (resolved) list.push({ kind: 'glad' });
    if (offerFor && !handoverReason && !openTicket) list.push({ kind: 'offer' });
    if (((handoverReason || failures >= 2) && !openTicket) || changingChannel) list.push({ kind: 'handover' });
    if (showTicket) list.push({ kind: 'ticket' });
    return list;
  }, [messages, failures, streaming, checkFor, handoverReason, openTicket, resolved, offerFor, changingChannel, showTicket]);

  const stage = rideStage(ride?.facts ?? null, Date.now());
  const pill = stagePill(stage);

  const header = (
    <View>
      <Text style={styles.aiLine}>{t('help.aiDisclosure')}</Text>
      <View style={styles.greetingRow}>
        <HelpAvatar size={40} />
        <Text style={styles.greeting} accessibilityRole="header">
          {firstName ? t('help.greetingName', { name: firstName }) : t('help.greeting')}
        </Text>
      </View>
      {ride && stage !== 'none' ? (
        <View style={styles.context}>
          <Text style={styles.contextLabel}>{t('help.yourRide')}</Text>
          <Text style={styles.contextMain} numberOfLines={2}>
            {ride.request.destination_address}
          </Text>
          <Text style={styles.contextMeta}>
            {new Date(ride.request.arrival_at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
          </Text>
          <View style={styles.contextFooter}>
            {pill ? <StatusPill status={pill} label={t(`help.stage.${stage}`)} /> : <View />}
            <Pressable onPress={() => send(t('help.helpWithRideQuestion'))} style={styles.contextButton} accessibilityRole="button" disabled={streaming}>
              <Text style={styles.contextButtonText}>{t('help.helpWithRide')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <View style={styles.chips}>
        {chipsFor(stage).map((topic) => (
          <Pressable key={topic} onPress={() => askTopic(topic)} style={styles.chip} accessibilityRole="button" disabled={streaming || !conversationId}>
            <Text style={styles.chipText}>{t(`help.chip.${topic}`)}</Text>
          </Pressable>
        ))}
      </View>
      {startFailed ? <ErrorNotice message={t('help.startError')} onRetry={() => start()} retryLabel={t('common.retry')} /> : null}
    </View>
  );

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.kind) {
      case 'message':
        return (
          <HelpMessageRow
            message={item.message}
            firstInGroup={item.firstInGroup}
            lastInGroup={item.lastInGroup}
            streaming={item.streaming}
            onAction={onAction}
            onFeedback={onFeedback}
          />
        );
      case 'retry':
        return (
          <View style={styles.inlineCard}>
            <Text style={styles.inlineText}>{t(failures >= 2 ? 'help.stillUnavailable' : 'help.unavailable')}</Text>
            {draft.trim() ? <SecondaryButton label={t('help.tryAgain')} icon="refresh" onPress={retry} /> : null}
          </View>
        );
      case 'check':
        return (
          <View style={styles.inlineCard}>
            <Text style={styles.inlineTitle}>{t('help_resolved_question')}</Text>
            <View style={styles.checkButtons}>
              <View style={styles.flex}>
                <SecondaryButton label={t('help.yes')} icon="thumbs-up-outline" onPress={() => answerCheck(true)} />
              </View>
              <View style={styles.flex}>
                <SecondaryButton label={t('help.no')} icon="thumbs-down-outline" onPress={() => answerCheck(false)} />
              </View>
            </View>
          </View>
        );
      case 'glad':
        return (
          <Text style={styles.glad} accessibilityLiveRegion="polite">
            {t('help.gladWeHelped')}
          </Text>
        );
      case 'offer':
        return (
          <View style={styles.inlineCard}>
            <Text style={styles.inlineText}>{t('help.offerTeam')}</Text>
            <SecondaryButton label={t('help.talkToPerson')} icon="person-outline" onPress={() => setHandoverReason(offerFor?.reason ?? 'user_asked')} />
          </View>
        );
      case 'handover':
        return conversationId ? (
          <HelpHandover
            conversationId={conversationId}
            reason={handoverReason ?? (failures >= 2 ? 'repeated_failure' : 'user_asked')}
            appLanguage={language}
            changeChannel={changingChannel}
            onTicket={() => {
              setHandoverReason(null);
              setChangingChannel(false);
              setFailures(0);
              loadTicket();
            }}
          />
        ) : null;
      case 'ticket':
        return ticket ? <HelpTicketCard ticket={ticket} onChangeChannel={() => setChangingChannel(true)} /> : null;
    }
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('admin.back')}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </Pressable>
          <HelpAvatar size={28} />
          <View style={styles.headerTitle}>
            <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
              {t('help.assistantName')}
            </Text>
            <View style={styles.aiBadge} accessible accessibilityLabel={t('help.aiBadgeLabel')}>
              <Text style={styles.aiBadgeText}>{t('help.aiBadge')}</Text>
            </View>
          </View>
          <Pressable onPress={openRequests} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('help.yourRequests')}>
            <Ionicons name="file-tray-outline" size={22} color={colors.textPrimary} />
          </Pressable>
          <Pressable onPress={() => start(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('help.newConversation')} disabled={streaming}>
            <Ionicons name="create-outline" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        {!openTicket && !handoverReason ? (
          <Pressable onPress={() => setHandoverReason('user_asked')} style={styles.person} accessibilityRole="button" disabled={!conversationId}>
            <Ionicons name="person-outline" size={16} color={colors.accentPrimaryStrong} />
            <Text style={styles.personText}>{t('help.talkToPerson')}</Text>
          </Pressable>
        ) : null}

        <FlatList
          ref={listRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          data={items}
          keyExtractor={(item, index) => (item.kind === 'message' ? item.message.id : `${item.kind}-${index}`)}
          renderItem={renderItem}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          initialNumToRender={20}
          windowSize={10}
        />

        <View style={styles.footer}>
          {sendError ? <ErrorNotice message={sendError} /> : null}
          {queued ? (
            <Text style={styles.queued} accessibilityLiveRegion="polite">
              {t('help.queued', { text: queued.length > 60 ? `${queued.slice(0, 60)}…` : queued })}
            </Text>
          ) : null}
          <HelpComposer value={draft} onChange={setDraft} onSend={sendDraft} disabled={streaming || !conversationId} offline={offline} />
        </View>
      </KeyboardAvoidingView>

      <Modal visible={requestsOpen} animationType="slide" transparent onRequestClose={() => setRequestsOpen(false)}>
        <View style={styles.requestsBackdrop}>
          <View style={styles.requestsSheet}>
            <View style={styles.requestsHeader}>
              <Text style={styles.title} accessibilityRole="header">
                {t('help.yourRequests')}
              </Text>
              <Pressable onPress={() => setRequestsOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('help.close')}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            {requests.length === 0 ? <Text style={styles.inlineText}>{t('help.noRequests')}</Text> : null}
            <FlatList
              data={requests}
              keyExtractor={(request) => request.reference}
              renderItem={({ item }) => <HelpTicketCard ticket={item} />}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x4,
    paddingBottom: spacing.x3,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.borderSubtle,
  },
  headerTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  title: {
    ...baseText.h3,
    flexShrink: 1,
  },
  aiBadge: {
    paddingHorizontal: spacing.x2,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.accentPrimarySoft,
  },
  aiBadgeText: {
    ...baseText.caption,
    color: colors.accentPrimaryStrong,
    fontWeight: '700',
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.x1,
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x2,
  },
  personText: {
    ...baseText.bodySmall,
    fontWeight: '700',
    color: colors.accentPrimaryStrong,
  },
  content: {
    paddingHorizontal: spacing.x4,
    paddingBottom: spacing.x6,
  },
  aiLine: {
    ...baseText.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.x3,
    marginBottom: spacing.x4,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    marginBottom: spacing.x4,
  },
  greeting: {
    ...baseText.h3,
    flex: 1,
  },
  context: {
    padding: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x1,
    marginBottom: spacing.x3,
  },
  contextLabel: {
    ...baseText.label,
    color: colors.textSecondary,
  },
  contextMain: {
    ...baseText.body,
    fontWeight: '700',
  },
  contextMeta: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  contextFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginTop: spacing.x2,
  },
  contextButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.x3,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimaryStrong,
  },
  contextButtonText: {
    ...baseText.bodySmall,
    fontWeight: '700',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.x4,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCardSolid,
  },
  chipText: {
    ...baseText.bodySmall,
    fontWeight: '600',
  },
  inlineCard: {
    marginTop: spacing.x3,
    padding: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x3,
  },
  inlineTitle: {
    ...baseText.body,
    fontWeight: '700',
  },
  inlineText: {
    ...baseText.body,
  },
  checkButtons: {
    flexDirection: 'row',
    gap: spacing.x2,
  },
  glad: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
  footer: {
    paddingHorizontal: spacing.x4,
    paddingTop: spacing.x2,
    paddingBottom: spacing.x6,
    backgroundColor: colors.bgPrimary,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.borderSubtle,
  },
  queued: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginBottom: spacing.x2,
  },
  requestsBackdrop: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  requestsSheet: {
    flex: 1,
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
  },
  requestsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.x3,
  },
});
