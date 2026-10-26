import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HelpConversationState, HelpRequest } from '../services/helpChat';
import type { MyTicket } from '../services/supportInbox';
import { baseText, borders, colors, radii, spacing, StatusName } from '../theme/colors';
import HelpTicketCard from './HelpTicketCard';
import StatusPill from './StatusPill';

type Props = {
  request: HelpRequest;
  // Its ticket while the team is on it: shown live ("We'll call you at 15:00").
  openTicket?: MyTicket | null;
  onOpen: () => void;
  // "Close request" - only on a pending item (still going, or waiting for our team).
  onClose?: () => void;
};

// The pill's look and label for each state (the pill styles are the ride ones: green done, amber
// waiting, grey closed, blue still going).
const STATE_PILL: Record<HelpConversationState, { status: StatusName; label: string }> = {
  resolved_by_assistant: { status: 'Group Confirmed', label: 'help.status.resolved' },
  resolved_by_team: { status: 'Group Confirmed', label: 'help.status.resolvedByTeam' },
  handed_over: { status: 'Driver En Route', label: 'help.status.waitingForTeam' },
  closed_no_reply: { status: 'Cancelled', label: 'help.status.closed' },
  closed_by_user: { status: 'Cancelled', label: 'help.status.closedByYou' },
  active: { status: 'Searching', label: 'help.status.inProgress' },
};

// One line of "Your requests": what it was about, when, how it stands, and its ride.
export default function HelpRequestItem({ request, openTicket, onOpen, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const pill = STATE_PILL[request.state];
  const when = new Date(request.last_message_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const title = request.title ?? t('help.untitled');
  return (
    <Pressable onPress={onOpen} style={styles.item} accessibilityRole="button" accessibilityLabel={`${title}, ${when}, ${t(pill.label)}`}>
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.date}>{when}</Text>
      </View>
      {request.ride ? (
        <Text style={styles.ride} numberOfLines={1}>
          {t('help.rideOf', { date: new Date(request.ride.arrival_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) })} ·{' '}
          {request.ride.destination_address}
        </Text>
      ) : null}
      <View style={styles.pill}>
        <StatusPill status={pill.status} label={t(pill.label)} />
      </View>
      {openTicket ? <HelpTicketCard ticket={openTicket} /> : null}
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" style={styles.close}>
          <Text style={styles.closeText}>{t('help.closeRequest')}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    padding: spacing.x4,
    marginBottom: spacing.x3,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x3,
  },
  title: {
    ...baseText.body,
    fontWeight: '700',
    flex: 1,
  },
  date: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  ride: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  pill: {
    flexDirection: 'row',
  },
  close: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
  },
  closeText: {
    ...baseText.bodySmall,
    fontWeight: '700',
    color: colors.dangerStrong,
    textDecorationLine: 'underline',
  },
});
