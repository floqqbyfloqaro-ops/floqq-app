import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fetchTickets, SupportTicket, TicketFilters } from '../services/supportInbox';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import Skeleton from './Skeleton';
import StatusPill from './StatusPill';

type Props = {
  onOpen: (ticket: SupportTicket) => void;
  // Changes after a ticket was handled, so the list reloads when the admin comes back.
  refreshKey?: number;
};

const STATUS_FILTERS: TicketFilters['status'][] = ['active', 'open', 'in_progress', 'no_answer', 'resolved', 'all'];
const CHANNEL_FILTERS: TicketFilters['channel'][] = ['all', 'callback', 'whatsapp'];
const LANGUAGE_FILTERS: TicketFilters['language'][] = ['all', 'en', 'fr', 'es'];

export const ticketStatusPill = (status: SupportTicket['status']) =>
  status === 'resolved' ? 'Group Confirmed' : status === 'no_answer' ? 'Cancelled' : 'Searching';

// "Minutes/hours/days ago", for how long a ticket has been waiting.
export function waitingFor(iso: string, nowMs = Date.now()): { unit: 'minutes' | 'hours' | 'days'; count: number } {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  if (minutes < 48 * 60) return { unit: 'hours', count: Math.floor(minutes / 60) };
  return { unit: 'days', count: Math.floor(minutes / (24 * 60)) };
}

// Admin dashboard, "Help" tab: the support inbox. Urgent tickets first, then the ones waiting
// longest; filters by status, channel and language.
export default function AdminSupportInbox({ onOpen, refreshKey }: Props) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<TicketFilters>({ status: 'active', channel: 'all', language: 'all' });
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await fetchTickets(filters);
    setIsLoading(false);
    if (error) {
      console.warn('fetchTickets failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setTickets(data ?? []);
  }, [filters]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const chipRow = <K extends keyof TicketFilters>(key: K, values: TicketFilters[K][], label: (value: TicketFilters[K]) => string) => (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {values.map((value) => (
        <Pressable
          key={String(value)}
          onPress={() => setFilters((current) => ({ ...current, [key]: value }))}
          style={[styles.chip, filters[key] === value && styles.chipSelected]}
          accessibilityRole="radio"
          accessibilityState={{ checked: filters[key] === value }}
        >
          <Text style={styles.chipText}>{label(value)}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View>
      {chipRow('status', STATUS_FILTERS, (value) => t(`adminSupport.status.${value}`))}
      {chipRow('channel', CHANNEL_FILTERS, (value) => t(`adminSupport.channel.${value}`))}
      {chipRow('language', LANGUAGE_FILTERS, (value) => (value === 'all' ? t('adminSupport.allLanguages') : value.toUpperCase()))}

      {loadFailed ? <ErrorNotice message={t('adminSupport.loadError')} onRetry={load} retryLabel={t('common.retry')} /> : null}
      {isLoading ? (
        <View accessible accessibilityLabel={t('admin.loading')}>
          {[0, 1, 2].map((i) => (
            <Card key={i} style={styles.row}>
              <Skeleton width={120} height={18} style={styles.gap} />
              <Skeleton width={220} height={14} />
            </Card>
          ))}
        </View>
      ) : tickets.length === 0 && !loadFailed ? (
        <Text style={styles.empty}>{t('adminSupport.empty')}</Text>
      ) : null}

      {tickets.map((ticket) => {
        const waiting = waitingFor(ticket.created_at);
        const statusLabel = t(`adminSupport.status.${ticket.status}`);
        return (
          <Card
            key={ticket.id}
            onPress={() => onOpen(ticket)}
            style={ticket.urgent && ticket.status !== 'resolved' ? [styles.row, styles.urgentRow] : styles.row}
            accessibilityLabel={[
              `#${ticket.reference}`,
              ticket.urgent ? t('adminSupport.urgent') : null,
              statusLabel,
              t(`adminSupport.channel.${ticket.channel}`),
              t(`adminSupport.waiting.${waiting.unit}`, { count: waiting.count }),
            ]
              .filter(Boolean)
              .join(', ')}
          >
            <View style={styles.titleRow}>
              <Text style={styles.reference}>#{ticket.reference}</Text>
              {ticket.urgent ? (
                <View style={styles.urgentBadge}>
                  <Text style={styles.urgentText}>{t('adminSupport.urgent')}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.metaRow}>
              <Ionicons name={ticket.channel === 'whatsapp' ? 'logo-whatsapp' : 'call-outline'} size={14} color={colors.textSecondary} />
              <Text style={styles.meta}>
                {t(`adminSupport.channel.${ticket.channel}`)} · {ticket.language.toUpperCase()} · {t(`adminSupport.reason.${ticket.category}`, { defaultValue: ticket.category })}
              </Text>
            </View>
            {ticket.channel === 'callback' && ticket.status !== 'resolved' ? (
              <Text style={styles.meta}>
                {ticket.callback_at ? t('adminSupport.callAt', { when: formatBarcelonaDateTime(ticket.callback_at) }) : t('adminSupport.callAsap')}
              </Text>
            ) : null}
            {ticket.summary ? (
              <Text style={styles.summary} numberOfLines={2}>
                {ticket.summary}
              </Text>
            ) : null}
            <View style={styles.footer}>
              <StatusPill status={ticketStatusPill(ticket.status)} label={statusLabel} />
              <Text style={styles.meta}>{t(`adminSupport.waiting.${waiting.unit}`, { count: waiting.count })}</Text>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginBottom: spacing.x3,
  },
  chip: {
    paddingVertical: spacing.x1,
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
  row: {
    marginBottom: spacing.x3,
  },
  urgentRow: {
    borderColor: colors.danger,
    borderWidth: borders.regular,
  },
  gap: {
    marginBottom: spacing.x2,
  },
  empty: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: spacing.x4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginBottom: spacing.x1,
  },
  reference: {
    ...baseText.h3,
  },
  urgentBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.x2,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
  },
  urgentText: {
    ...baseText.caption,
    color: colors.dangerStrong,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
  },
  meta: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  summary: {
    ...baseText.bodySmall,
    marginTop: spacing.x2,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.x2,
  },
});
