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
import HelpClosingCard from '../components/HelpClosingCard';
import HelpComposer from '../components/HelpComposer';
import HelpHandover from '../components/HelpHandover';
import HelpMessageRow from '../components/HelpMessageRow';
import HelpRequestItem from '../components/HelpRequestItem';
import HelpTicketCard from '../components/HelpTicketCard';
import PrimaryButton from '../components/PrimaryButton';
import SecondaryButton from '../components/SecondaryButton';
import StatusPill from '../components/StatusPill';
import {
  decideHelpAction,
  endHelpConversation,
  fetchHelpTopic,
  fetchMyHelpRequests,
  HelpAction,
  HelpConversation,
  helpLanguageFor,
  HelpMessage,
  hasClosingCard,
  HelpRequest,
  isArchived,
  isResolved,
  openHelpConversation,
  rateHelpConversation,
  sendHelpMessageStreamed,
  startHelpConversation,
} from '../services/helpChat';
import { BOOK_NEW_RIDE, chipsFor, HelpFollowup, HelpRideFacts, HelpTopic, HelpTopicGroup, isFollowup, rideStage, stagePill, TOPIC_GROUPS } from '../services/helpChips';
import { plainText } from '../services/helpMarkdown';
import { fetchMyGroupStatus, fetchMyLatestRequest, MyPassengerRequest } from '../services/passengerRequests';
import { supabase } from '../services/supabase';
import { fetchMyLatestTicket, fetchMyTickets, MyTicket } from '../services/supportInbox';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  onBack: () => void;
  // Where the answers' buttons lead. None of them changes anything by itself.
  onOpenMyRide: () => void;
  onEditRide: (requestId: string) => void;
  onOpenPaymentMethods: () => void;
  onShowBadge: () => void;
  // "Book a new ride" (a follow-up chip after a cancellation).
  onNewRide: () => void;
};

type Item =
  | { kind: 'message'; message: HelpMessage; firstInGroup: boolean; lastInGroup: boolean; streaming: boolean }
  | { kind: 'followups'; topics: HelpFollowup[] }
  | { kind: 'closing' }
  | { kind: 'closed' }
  | { kind: 'retry' }
  | { kind: 'handover' }
  | { kind: 'ticket' };

const SEND_ERRORS: Record<string, string> = {
  rate_limited: 'help.rateLimited',
  message_too_long: 'help.tooLong',
};

const TICKET_REFRESH_MS = 20_000;
const STREAMING_ID = 'streaming';

type StartOptions = { fresh?: boolean; previousConversationId?: string };

// The light confirmations: "End this chat?", then (with a request to the team waiting) "Cancel it
// too?"; "Close this request?" from "Your requests".
type Confirm = { kind: 'end' } | { kind: 'endTicket' } | { kind: 'close'; conversationId: string };

// "Help": the FLOQQ Assistant, a full-screen chat. It greets the passenger by name, knows their
// current ride (a context card, and suggested questions that follow the ride), streams its answers,
// shows the passenger's own data as cards and offers buttons to the right screen. A conversation
// ends like with a good human agent: the passenger says they're done (a warm closing and a closing
// card with "Was this helpful?"), or it goes quiet (archived). The assistant can also do some
// things itself - cancel the ride, resend the email change confirmation - each on a confirmation
// card that only the passenger's tap acts on.
// The team is offered only when it makes sense - and is always reachable from the … menu. Archived
// conversations are read-only, in "Your requests", each with "I still need help with this" (a new
// conversation that knows the earlier one); writing below an archived one does the same. Typed
// text is never lost, a message written offline goes out once the phone is back online, and when
// the assistant can't be reached the suggested questions still get the knowledge base's answer.
export default function HelpScreen({ onBack, onOpenMyRide, onEditRide, onOpenPaymentMethods, onShowBadge, onNewRide }: Props) {
  const { t, i18n } = useTranslation();
  const language = helpLanguageFor(i18n.language);
  const network = useNetworkState();
  const offline = network.isConnected === false || network.isInternetReachable === false;

  const [userId, setUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<HelpConversation | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [startFailed, setStartFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [queued, setQueued] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [handoverReason, setHandoverReason] = useState<string | null>(null);
  const [ticket, setTicket] = useState<MyTicket | null>(null);
  const [changingChannel, setChangingChannel] = useState(false);
  const [ride, setRide] = useState<{ request: MyPassengerRequest; facts: HelpRideFacts } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [requestTickets, setRequestTickets] = useState<MyTicket[]>([]);
  // A conversation from "Your requests", opened to read.
  const [viewing, setViewing] = useState<{ conversation: HelpConversation; messages: HelpMessage[] } | null>(null);
  const listRef = useRef<FlatList<Item>>(null);
  const sendingRef = useRef(false);

  const draftKey = userId ? `help-draft:${userId}` : null;
  const queueKey = userId ? `help-queue:${userId}` : null;
  const archived = isArchived(conversation?.state);

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

  // fresh: a new conversation; previousConversationId: "I still need help with this". Returns the
  // conversation now shown.
  const start = useCallback(
    async (options: StartOptions = {}) => {
      setStartFailed(false);
      setHandoverReason(null);
      setSendError(null);
      setFailures(0);
      const result = await startHelpConversation(language, options);
      if (result.error || !result.conversationId) {
        setStartFailed(true);
        return null;
      }
      setConversationId(result.conversationId);
      setConversation(result.conversation);
      setMessages(result.messages);
      setFirstName(result.firstName);
      loadTicket();
      return result.conversationId;
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
    async (text: string, target: string | null) => {
      if (!target || sendingRef.current) return;
      sendingRef.current = true;
      setSendError(null);
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

      const { answer, error } = await sendHelpMessageStreamed(target, text, language, {
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
        if (answer.conversation) setConversation(answer.conversation);
        if (answer.handoverReason) setHandoverReason((reason) => reason ?? answer.handoverReason);
        return;
      }

      // Not answered: nothing is lost.
      setMessages((current) => current.filter((m) => m.id !== STREAMING_ID && m.id !== local.id));
      if (error === 'interrupted') {
        // The server still finished and stored it: show what it has.
        start();
        return;
      }
      if (error === 'conversation_closed') {
        // Archived meanwhile (it went quiet): carry on in a new conversation that knows it.
        const next = await start({ previousConversationId: target });
        if (next) send(text, next);
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
    [language, queueKey, start, t]
  );

  // Below an archived conversation, writing again starts a new one that knows it.
  const sendToCurrent = useCallback(
    async (text: string) => {
      if (archived && conversationId) {
        const next = await start({ previousConversationId: conversationId });
        if (next) send(text, next);
        return;
      }
      send(text, conversationId);
    },
    [archived, conversationId, send, start]
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
    sendToCurrent(text);
  };

  // Back online: the waiting message goes out by itself.
  useEffect(() => {
    if (offline || !queued || !conversationId || sendingRef.current) return;
    const text = queued;
    setQueued(null);
    if (queueKey) AsyncStorage.removeItem(queueKey).catch(() => {});
    sendToCurrent(text);
  }, [offline, queued, conversationId, queueKey, sendToCurrent]);

  const retry = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendToCurrent(text);
  };

  // Suggested questions: asked like any message - or, when the assistant can't be reached, answered
  // straight from the knowledge base.
  const askTopic = async (topic: HelpTopic) => {
    const question = t(`help.chip.${topic}`);
    if (failures < 2) return sendToCurrent(question);
    const { article } = await fetchHelpTopic(topic, language);
    const now = new Date().toISOString();
    setMessages((current) => [
      ...current,
      { id: `topic-q-${Date.now()}`, role: 'user', content: question, created_at: now },
      { id: `topic-a-${Date.now()}`, role: 'assistant', content: article ? `**${article.title}**\n\n${article.content}` : t('help.unavailable'), created_at: now },
    ]);
  };

  const tapChip = (chip: HelpFollowup) => {
    setTopicsOpen(false);
    if (chip === BOOK_NEW_RIDE) return onNewRide();
    askTopic(chip);
  };

  // "End chat": archived as closed by the passenger, with a short closing and "Was this helpful?";
  // cancelTicket also closes their waiting request to the team.
  const endChat = async (cancelTicket: boolean) => {
    setConfirm(null);
    if (!conversationId) return;
    const result = await endHelpConversation(conversationId, cancelTicket, language);
    if (!result.conversation) return setSendError(t('help.card.error'));
    setConversation(result.conversation);
    if (result.message) setMessages((current) => [...current, result.message!]);
    setHandoverReason(null);
    loadTicket();
  };

  // "Close request" in "Your requests": the conversation and its request to the team.
  const closeRequest = async (id: string) => {
    setConfirm(null);
    const result = await endHelpConversation(id, true, language);
    if (!result.conversation) return setSendError(t('help.card.error'));
    if (id === conversationId) {
      setConversation(result.conversation);
      if (result.message) setMessages((current) => [...current, result.message!]);
      loadTicket();
    }
    const [conversations, tickets] = await Promise.all([fetchMyHelpRequests(), fetchMyTickets()]);
    setRequests(conversations);
    setRequestTickets(tickets);
    if (viewing?.conversation.id === id) viewRequest(id);
  };

  // A tap on a confirmation card ("Cancel my ride" / "Keep it", "Resend email" / "Not now"): the
  // server does it, the card shows how it ended and the assistant says what happened.
  const decide = useCallback(
    async (actionId: string, decision: 'confirm' | 'keep') => {
      const result = await decideHelpAction(actionId, decision, language);
      if (!result.message) {
        setSendError(t('help.card.error'));
        return;
      }
      setSendError(null);
      setMessages((current) => [
        ...current.map((m) => (result.card && m.id === result.card.messageId ? { ...m, cards: result.card.cards } : m)),
        result.message!,
      ]);
      if (result.conversation) setConversation(result.conversation);
      AccessibilityInfo.announceForAccessibility(plainText(result.message.content));
      // A cancelled ride changes the ride card at the top.
      if (decision === 'confirm') loadRide();
    },
    [language, loadRide, t]
  );

  const rate = (id: string, value: 'up' | 'down') => {
    rateHelpConversation(id, value);
  };

  // The … menu's "Contact the FLOQQ team": always honoured. From an archived conversation, in a new
  // one that knows it.
  const contactTeam = async () => {
    setMenuOpen(false);
    if (archived && conversationId) {
      const next = await start({ previousConversationId: conversationId });
      if (!next) return;
    }
    setHandoverReason('user_asked');
  };

  const onAction = (action: HelpAction) => {
    if (action === 'open_my_ride' || action === 'cancel_ride') onOpenMyRide();
    else if (action === 'edit_ride') ride ? onEditRide(ride.request.id) : onOpenMyRide();
    else if (action === 'payment_methods') onOpenPaymentMethods();
    else if (action === 'show_badge') onShowBadge();
    else if (action === 'location_settings') Linking.openSettings().catch(() => {});
  };

  // --- "Your requests" ---

  const openRequests = async () => {
    setViewing(null);
    setRequestsOpen(true);
    const [conversations, tickets] = await Promise.all([fetchMyHelpRequests(), fetchMyTickets()]);
    setRequests(conversations);
    setRequestTickets(tickets);
  };

  const openTicketFor = (id: string) => requestTickets.find((item) => item.conversation_id === id && item.status !== 'resolved') ?? null;
  // Waiting for our team first, then newest first (the order they came in).
  const sortedRequests = [...requests].sort((a, b) => Number(openTicketFor(b.id) != null) - Number(openTicketFor(a.id) != null));

  // Still going, or waiting for our team: it can be closed.
  const isPending = (request: { id: string; state: string }) =>
    request.state === 'active' || request.state === 'handed_over' || openTicketFor(request.id) != null;

  const viewRequest = async (id: string) => {
    const opened = await openHelpConversation(id);
    if (opened.conversation) setViewing({ conversation: opened.conversation, messages: opened.messages });
  };

  // "I still need help with this": a new conversation linked to the one being read.
  const stillNeedHelp = async (previousConversationId: string) => {
    setRequestsOpen(false);
    setViewing(null);
    await start({ previousConversationId });
  };

  // --- What the list shows ---

  const openTicket = ticket != null && ticket.status !== 'resolved';
  const ticketForThisChat = openTicket && ticket?.conversation_id === conversationId;
  const canEnd = (conversation?.state === 'active' || conversation?.state === 'handed_over') && messages.length > 0 && !streaming;
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
    // Suggested next questions under the latest answer.
    const last = messages[messages.length - 1];
    const next = (last?.role === 'assistant' ? (last.followup_topics ?? []) : []).filter(isFollowup);
    if (next.length && !streaming && !handoverReason && (conversation?.state === 'active' || conversation?.state === 'handed_over')) {
      list.push({ kind: 'followups', topics: next });
    }
    if (hasClosingCard(conversation?.state)) list.push({ kind: 'closing' });
    else if (conversation?.state === 'closed_no_reply' && messages.length > 0) list.push({ kind: 'closed' });
    if (((handoverReason || failures >= 2) && !openTicket) || changingChannel) list.push({ kind: 'handover' });
    if (showTicket) list.push({ kind: 'ticket' });
    return list;
  }, [messages, failures, streaming, conversation?.state, handoverReason, openTicket, changingChannel, showTicket]);

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
      {conversation?.previous_conversation_id ? <Text style={styles.continuing}>{t('help.continuing')}</Text> : null}
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
            <Pressable onPress={() => sendToCurrent(t('help.helpWithRideQuestion'))} style={styles.contextButton} accessibilityRole="button" disabled={streaming}>
              <Text style={styles.contextButtonText}>{t('help.helpWithRide')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {messages.length === 0 ? (
        <View style={styles.chips}>
          {chipsFor(stage).map((topic) => (
            <Pressable key={topic} onPress={() => tapChip(topic)} style={styles.chip} accessibilityRole="button" disabled={streaming || !conversationId}>
              <Text style={styles.chipText}>{t(`help.chip.${topic}`)}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setTopicsOpen(true)} style={[styles.chip, styles.moreChip]} accessibilityRole="button">
            <Text style={styles.chipText}>{t('help.moreTopics')}</Text>
          </Pressable>
        </View>
      ) : null}
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
            onDecide={archived ? undefined : decide}
          />
        );
      case 'retry':
        return (
          <View style={styles.inlineCard}>
            <Text style={styles.inlineText}>{t(failures >= 2 ? 'help.stillUnavailable' : 'help.unavailable')}</Text>
            {draft.trim() ? <SecondaryButton label={t('help.tryAgain')} icon="refresh" onPress={retry} /> : null}
          </View>
        );
      case 'followups':
        return (
          <View style={[styles.chips, styles.followups]}>
            {item.topics.map((topic) => (
              <Pressable key={topic} onPress={() => tapChip(topic)} style={styles.chip} accessibilityRole="button" disabled={streaming}>
                <Text style={styles.chipText}>{t(`help.chip.${topic}`)}</Text>
              </Pressable>
            ))}
          </View>
        );
      case 'closing':
        return conversation ? (
          <HelpClosingCard
            key={conversation.id}
            title={conversation.title}
            helpful={conversation.helpful}
            byTeam={conversation.state === 'resolved_by_team'}
            onRate={(value) => rate(conversation.id, value)}
          />
        ) : null;
      case 'closed':
        return <Text style={styles.closed}>{t('help.closedNoReply')}</Text>;
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
          <Pressable onPress={openRequests} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('your_requests')}>
            <Ionicons name="file-tray-outline" size={22} color={colors.textPrimary} />
          </Pressable>
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('help.menu')}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        {canEnd ? (
          <View style={styles.endBar}>
            <Pressable onPress={() => setConfirm({ kind: 'end' })} hitSlop={8} accessibilityRole="button" style={styles.endButton}>
              <Ionicons name="checkmark-done-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.endText}>{t('help.endChat')}</Text>
            </Pressable>
          </View>
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

      {/* The … menu: a new conversation, and the team - reachable, never pushed. */}
      <Modal visible={menuOpen} animationType="fade" transparent onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} accessibilityRole="button" accessibilityLabel={t('help.close')}>
          <View style={styles.menu}>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                start({ fresh: true });
              }}
              style={styles.menuItem}
              accessibilityRole="button"
              disabled={streaming}
            >
              <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.menuText}>{t('help.newConversation')}</Text>
            </Pressable>
            {!openTicket ? (
              <Pressable onPress={contactTeam} style={styles.menuItem} accessibilityRole="button" disabled={!conversationId}>
                <Ionicons name="person-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.menuText}>{t('help.contactTeam')}</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={topicsOpen} animationType="slide" transparent onRequestClose={() => setTopicsOpen(false)}>
        <View style={styles.requestsBackdrop}>
          <View style={styles.requestsSheet}>
            <View style={styles.requestsHeader}>
              <Text style={[styles.title, styles.flex]} accessibilityRole="header">
                {t('help.allTopics')}
              </Text>
              <Pressable onPress={() => setTopicsOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('help.close')}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            <FlatList
              data={Object.keys(TOPIC_GROUPS) as HelpTopicGroup[]}
              keyExtractor={(group) => group}
              renderItem={({ item: group }) => (
                <View style={styles.topicGroup}>
                  <Text style={styles.topicGroupTitle}>{t(`help.topicGroup.${group}`)}</Text>
                  <View style={styles.chips}>
                    {(TOPIC_GROUPS[group] as readonly HelpTopic[]).map((topic) => (
                      <Pressable key={topic} onPress={() => tapChip(topic)} style={styles.chip} accessibilityRole="button" disabled={streaming || !conversationId}>
                        <Text style={styles.chipText}>{t(`help.chip.${topic}`)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={confirm != null} animationType="fade" transparent onRequestClose={() => setConfirm(null)}>
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard} accessibilityViewIsModal>
            {confirm?.kind === 'end' ? (
              <>
                <Text style={styles.confirmTitle}>{t('help.endConfirmTitle')}</Text>
                <PrimaryButton label={t('help.endConfirm')} onPress={() => (ticketForThisChat ? setConfirm({ kind: 'endTicket' }) : endChat(false))} />
                <SecondaryButton label={t('help.endContinue')} onPress={() => setConfirm(null)} />
              </>
            ) : confirm?.kind === 'endTicket' ? (
              <>
                <Text style={styles.confirmTitle}>{t('help.endTicketQuestion')}</Text>
                <PrimaryButton label={t('help.endTicketCancel')} onPress={() => endChat(true)} />
                <SecondaryButton label={t('help.endTicketKeep')} onPress={() => endChat(false)} />
              </>
            ) : confirm?.kind === 'close' ? (
              <>
                <Text style={styles.confirmTitle}>{t('help.closeRequestTitle')}</Text>
                <Text style={styles.inlineText}>{t('help.closeRequestMessage')}</Text>
                <PrimaryButton label={t('help.closeRequest')} onPress={() => closeRequest(confirm.conversationId)} />
                <SecondaryButton label={t('help.closeRequestKeep')} onPress={() => setConfirm(null)} />
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={requestsOpen} animationType="slide" transparent onRequestClose={() => (viewing ? setViewing(null) : setRequestsOpen(false))}>
        <View style={styles.requestsBackdrop}>
          <View style={styles.requestsSheet}>
            <View style={styles.requestsHeader}>
              {viewing ? (
                <Pressable onPress={() => setViewing(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('admin.back')}>
                  <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
              ) : null}
              <Text style={[styles.title, styles.flex]} accessibilityRole="header" numberOfLines={1}>
                {viewing ? (viewing.conversation.title ?? t('help.untitled')) : t('your_requests')}
              </Text>
              <Pressable onPress={() => setRequestsOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('help.close')}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            {viewing ? (
              <FlatList
                data={viewing.messages}
                keyExtractor={(message) => message.id}
                renderItem={({ item, index }) => (
                  <HelpMessageRow
                    message={item}
                    firstInGroup={index === 0 || viewing.messages[index - 1].role !== item.role}
                    lastInGroup={index === viewing.messages.length - 1 || viewing.messages[index + 1].role !== item.role}
                    onAction={() => {}}
                  />
                )}
                ListFooterComponent={
                  <View style={styles.viewingFooter}>
                    {isPending(viewing.conversation) ? (
                      <SecondaryButton label={t('help.closeRequest')} icon="close-circle-outline" onPress={() => setConfirm({ kind: 'close', conversationId: viewing.conversation.id })} />
                    ) : null}
                    {hasClosingCard(viewing.conversation.state) ? (
                      <HelpClosingCard
                        key={viewing.conversation.id}
                        title={viewing.conversation.title}
                        helpful={viewing.conversation.helpful}
                        byTeam={viewing.conversation.state === 'resolved_by_team'}
                        onRate={(value) => rate(viewing.conversation.id, value)}
                      />
                    ) : null}
                    {isArchived(viewing.conversation.state) ? (
                      <PrimaryButton label={t('help.stillNeedHelp')} onPress={() => stillNeedHelp(viewing.conversation.id)} />
                    ) : (
                      <SecondaryButton
                        label={t('help.backToConversation')}
                        onPress={() => {
                          setRequestsOpen(false);
                          setViewing(null);
                          start();
                        }}
                      />
                    )}
                  </View>
                }
              />
            ) : (
              <>
                {requests.length === 0 ? <Text style={styles.inlineText}>{t('help.noRequests')}</Text> : null}
                <FlatList
                  data={sortedRequests}
                  keyExtractor={(request) => request.id}
                  renderItem={({ item }) => (
                    <HelpRequestItem
                      request={item}
                      openTicket={openTicketFor(item.id)}
                      onOpen={() => viewRequest(item.id)}
                      onClose={isPending(item) ? () => setConfirm({ kind: 'close', conversationId: item.id }) : undefined}
                    />
                  )}
                />
              </>
            )}
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
  continuing: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginBottom: spacing.x3,
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
  moreChip: {
    borderColor: colors.accentPrimaryStrong,
  },
  followups: {
    marginTop: spacing.x3,
    marginLeft: 40,
  },
  endBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x2,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.borderSubtle,
  },
  endButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
    minHeight: 32,
  },
  endText: {
    ...baseText.bodySmall,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  topicGroup: {
    marginBottom: spacing.x6,
  },
  topicGroupTitle: {
    ...baseText.label,
    color: colors.textSecondary,
    marginBottom: spacing.x2,
  },
  confirmBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.x6,
    backgroundColor: overlays.scrimLight,
  },
  confirmCard: {
    padding: spacing.x6,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCardSolid,
    gap: spacing.x3,
  },
  confirmTitle: {
    ...baseText.h3,
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
  inlineText: {
    ...baseText.body,
  },
  closed: {
    ...baseText.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.x4,
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
  menuBackdrop: {
    flex: 1,
    alignItems: 'flex-end',
    paddingTop: spacing.x12 + spacing.x8,
    paddingHorizontal: spacing.x4,
    backgroundColor: overlays.scrimLight,
  },
  menu: {
    minWidth: 240,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCardSolid,
    paddingVertical: spacing.x1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    minHeight: 48,
    paddingHorizontal: spacing.x4,
  },
  menuText: {
    ...baseText.body,
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
    gap: spacing.x3,
    marginBottom: spacing.x3,
  },
  viewingFooter: {
    gap: spacing.x4,
    paddingVertical: spacing.x6,
  },
});
