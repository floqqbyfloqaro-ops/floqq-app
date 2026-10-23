import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import type { CardStatus, HelpCard } from '../services/helpChat';
import { formatCents } from '../services/payments';
import { baseText, borders, colors, radii, spacing, StatusName } from '../theme/colors';
import StatusPill from './StatusPill';

type Props = {
  card: HelpCard;
};

const RIDE_PILL: Record<Extract<HelpCard, { type: 'ride' }>['status'], StatusName> = {
  searching: 'Searching',
  match_found: 'Searching',
  confirmed: 'Group Confirmed',
  on_the_way: 'Driver En Route',
  completed: 'Group Confirmed',
  cancelled: 'Cancelled',
  expired: 'Cancelled',
};

const STATUS_COLOR: Record<CardStatus | 'none', string> = {
  paid: colors.success,
  pending: colors.warning,
  refunded: colors.info,
  released: colors.info,
  failed: colors.dangerStrong,
  paid_to_taxi: colors.textSecondary,
  none: colors.textSecondary,
};

// The passenger's own data in the conversation, as a card instead of a paragraph: their ride, their
// payment (the fee and their share, each with its real status) or their refund. The figures come
// from the server, never from the assistant's text.
export default function HelpDataCard({ card }: Props) {
  const { t, i18n } = useTranslation();
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { dateStyle: 'medium' });

  if (card.type === 'ride') {
    const status = t(`help.rideStatus.${card.status}`);
    return (
      <View style={styles.card} accessible accessibilityLabel={[t('help.card.ride'), card.destination, when(card.at), status, card.meetingPoint].filter(Boolean).join(', ')}>
        <View style={styles.titleRow}>
          <Ionicons name="car-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.title}>{t('help.card.ride')}</Text>
        </View>
        <Text style={styles.main} numberOfLines={2}>
          {card.destination}
        </Text>
        <Text style={styles.meta}>{when(card.at)}</Text>
        {card.meetingPoint ? <Text style={styles.meta}>{t('help.card.meetingPoint', { point: card.meetingPoint })}</Text> : null}
        <View style={styles.pill}>
          <StatusPill status={RIDE_PILL[card.status]} label={status} />
        </View>
      </View>
    );
  }

  if (card.type === 'payment') {
    return (
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Ionicons name="card-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.title}>{t('help.card.payment')}</Text>
        </View>
        {card.lines.map((line) => {
          const label = t(line.kind === 'fee' ? 'help.card.fee' : 'help.card.share');
          const amount = line.amountCents != null ? `€${formatCents(line.amountCents)}` : '-';
          const status = t(`help.cardStatus.${line.status}`);
          return (
            <View
              key={line.kind}
              style={styles.line}
              accessible
              accessibilityLabel={[label, amount, status, line.date ? date(line.date) : null].filter(Boolean).join(', ')}
            >
              <View style={styles.lineText}>
                <Text style={styles.lineLabel}>{label}</Text>
                {line.date ? <Text style={styles.meta}>{date(line.date)}</Text> : null}
              </View>
              <View style={styles.lineRight}>
                <Text style={styles.amount}>{amount}</Text>
                <Text style={[styles.status, { color: STATUS_COLOR[line.status] }]}>{status}</Text>
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  const amount = card.amountCents != null ? `€${formatCents(card.amountCents)}` : null;
  const status = t(`help.refundStatus.${card.status}`);
  return (
    <View style={styles.card} accessible accessibilityLabel={[t('help.card.refund'), amount, status, card.date ? date(card.date) : null].filter(Boolean).join(', ')}>
      <View style={styles.titleRow}>
        <Ionicons name="return-down-back-outline" size={18} color={colors.textSecondary} />
        <Text style={styles.title}>{t('help.card.refund')}</Text>
      </View>
      {amount ? <Text style={styles.main}>{amount}</Text> : null}
      <Text style={[styles.status, { color: STATUS_COLOR[card.status === 'pending' ? 'pending' : card.status === 'none' ? 'none' : 'released'] }]}>{status}</Text>
      {card.date ? <Text style={styles.meta}>{date(card.date)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.x2,
    padding: spacing.x3,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  title: {
    ...baseText.label,
    color: colors.textSecondary,
  },
  main: {
    ...baseText.body,
    fontWeight: '700',
  },
  meta: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  pill: {
    marginTop: spacing.x1,
    alignSelf: 'flex-start',
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.x3,
    paddingVertical: spacing.x1,
  },
  lineText: {
    flex: 1,
  },
  lineLabel: {
    ...baseText.bodySmall,
  },
  lineRight: {
    alignItems: 'flex-end',
  },
  amount: {
    ...baseText.body,
    fontWeight: '700',
  },
  status: {
    ...baseText.caption,
    fontWeight: '700',
  },
});
