import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MyTicket } from '../services/supportInbox';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import { barcelonaDateParts, barcelonaWeekday } from '../utils/formatDateTime';

type Props = {
  ticket: MyTicket;
  // After "We tried to call you": choose WhatsApp or another call.
  onChangeChannel?: () => void;
};

// The passenger's ticket in the conversation: its reference, how the team will reach them, and
// what happens next - kept up to date while it is open ("We'll call you at 15:00" -> "Resolved").
export default function HelpTicketCard({ ticket, onChangeChannel }: Props) {
  const { t, i18n } = useTranslation();
  const reference = ticket.reference;
  const callAt = ticket.callback_at
    ? (() => {
        const { hour, minute } = barcelonaDateParts(ticket.callback_at);
        return t('help.weekdayTime', { weekday: barcelonaWeekday(ticket.callback_at, i18n.language), time: `${hour}:${minute}` });
      })()
    : null;
  const closedByYou = ticket.status === 'resolved' && ticket.resolution_category === 'closed_by_user';
  const text =
    closedByYou
      ? t('help.ticketClosedByYou', { reference })
      : ticket.status === 'resolved'
      ? t('help.ticketResolved', { reference })
      : ticket.status === 'no_answer'
        ? t('help.ticketNoAnswer', { reference })
        : ticket.channel === 'whatsapp'
          ? t('help.ticketWaitingWhatsApp', { reference })
          : callAt
            ? t('help.ticketCallAt', { when: callAt, reference })
            : ticket.status === 'in_progress'
              ? t('help.ticketInProgress', { reference })
              : t('help.ticketCallAsap', { reference });
  const icon = ticket.status === 'resolved' ? 'checkmark-circle' : ticket.status === 'no_answer' ? 'call-outline' : ticket.channel === 'whatsapp' ? 'logo-whatsapp' : 'time-outline';
  const color = ticket.status === 'resolved' ? colors.success : ticket.status === 'no_answer' ? colors.warning : colors.info;

  return (
    <View style={styles.card} accessible={ticket.status !== 'no_answer'} accessibilityLabel={text} accessibilityLiveRegion="polite">
      <View style={styles.header}>
        <Text style={styles.reference}>#{reference}</Text>
        <Text style={styles.channel}>{t(`help.ticketChannel.${ticket.channel}`)}</Text>
      </View>
      <View style={styles.row}>
        <Ionicons name={icon} size={20} color={color} />
        <Text style={styles.text}>{text}</Text>
      </View>
      {ticket.status === 'no_answer' && onChangeChannel ? (
        <Pressable onPress={onChangeChannel} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>{t('help.chooseHowToReach')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.x3,
    padding: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reference: {
    ...baseText.h3,
  },
  channel: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x2,
  },
  text: {
    ...baseText.body,
    flex: 1,
  },
  button: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.x4,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimaryStrong,
  },
  buttonText: {
    ...baseText.bodySmall,
    fontWeight: '700',
  },
});
