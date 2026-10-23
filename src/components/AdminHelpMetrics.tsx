import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { fetchHelpMetrics, HelpMetrics, percent } from '../services/helpMetrics';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import { barcelonaDateParts, formatBarcelonaDateTime, fromBarcelonaWallClock } from '../utils/formatDateTime';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import Skeleton from './Skeleton';

type Props = {
  refreshKey?: number;
};

// The first day of this month, 00:00 Barcelona time.
function monthStartIso(): string {
  const { year, month } = barcelonaDateParts(new Date());
  return fromBarcelonaWallClock(new Date(Number(year), Number(month) - 1, 1, 0, 0)).toISOString();
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}${hint ? `, ${hint}` : ''}`}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {hint ? <Text style={styles.tileHint}>{hint}</Text> : null}
    </View>
  );
}

// Admin dashboard, Help tab, "Overview": how the help assistant did this month - conversations,
// solved by the assistant, handovers and why, WhatsApp vs call back, time to the first human
// contact, open urgent tickets, thumbs down with their question, and what the AI cost.
export default function AdminHelpMetrics({ refreshKey }: Props) {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<HelpMetrics | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const { metrics: next, error } = await fetchHelpMetrics(monthStartIso());
    if (error || !next) {
      console.warn('fetchHelpMetrics failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setMetrics(next);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loadFailed) return <ErrorNotice message={t('adminHelpMetrics.loadError')} onRetry={load} retryLabel={t('common.retry')} />;
  if (!metrics) {
    return (
      <Card accessible accessibilityLabel={t('admin.loading')}>
        <Skeleton width={200} height={18} />
      </Card>
    );
  }

  const solved = percent(metrics.resolved_by_assistant, metrics.conversations);
  const handover = percent(metrics.handed_over, metrics.conversations);
  const channelTotal = (metrics.channels.whatsapp ?? 0) + (metrics.channels.callback ?? 0);
  const reasons = Object.entries(metrics.handover_reasons).sort((a, b) => b[1] - a[1]);

  return (
    <View>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {t('adminHelpMetrics.title')}
      </Text>
      <View style={styles.tiles}>
        <Tile label={t('adminHelpMetrics.conversations')} value={String(metrics.conversations)} />
        <Tile label={t('adminHelpMetrics.solvedByAssistant')} value={solved != null ? `${solved}%` : '-'} hint={t('adminHelpMetrics.ofConversations', { count: metrics.resolved_by_assistant })} />
        <Tile label={t('adminHelpMetrics.handoverRate')} value={handover != null ? `${handover}%` : '-'} hint={t('adminHelpMetrics.ofConversations', { count: metrics.handed_over })} />
        <Tile
          label={t('adminHelpMetrics.firstContact')}
          value={metrics.avg_minutes_to_first_contact != null ? t('adminHelpMetrics.minutes', { count: metrics.avg_minutes_to_first_contact }) : '-'}
        />
        <Tile label={t('adminHelpMetrics.openUrgent')} value={String(metrics.open_urgent_tickets)} hint={t('adminHelpMetrics.openTickets', { count: metrics.open_tickets })} />
        <Tile label={t('adminHelpMetrics.aiCost')} value={`$${Number(metrics.ai_cost_usd).toFixed(2)}`} />
      </View>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminHelpMetrics.channels')}</Text>
        {channelTotal === 0 ? (
          <Text style={styles.meta}>{t('adminHelpMetrics.none')}</Text>
        ) : (
          (['whatsapp', 'callback'] as const).map((channel) => (
            <View key={channel} style={styles.barRow}>
              <Text style={styles.barLabel}>{t(`adminSupport.channel.${channel}`)}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${percent(metrics.channels[channel] ?? 0, channelTotal) ?? 0}%` }]} />
              </View>
              <Text style={styles.barValue}>{metrics.channels[channel] ?? 0}</Text>
            </View>
          ))
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminHelpMetrics.reasons')}</Text>
        {reasons.length === 0 ? <Text style={styles.meta}>{t('adminHelpMetrics.none')}</Text> : null}
        {reasons.map(([reason, count]) => (
          <View key={reason} style={styles.reasonRow}>
            <Text style={styles.body}>{t(`adminSupport.reason.${reason}`, { defaultValue: reason })}</Text>
            <Text style={styles.body}>{count}</Text>
          </View>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t('adminHelpMetrics.feedback', { up: metrics.thumbs_up, down: metrics.thumbs_down })}</Text>
        {metrics.thumbs_down_answers.length === 0 ? <Text style={styles.meta}>{t('adminHelpMetrics.noThumbsDown')}</Text> : null}
        {metrics.thumbs_down_answers.map((item, index) => (
          <View key={`${item.at}-${index}`} style={styles.feedbackItem}>
            <Text style={styles.meta}>{formatBarcelonaDateTime(item.at)}</Text>
            {item.question ? <Text style={styles.question}>“{item.question}”</Text> : null}
            <Text style={styles.answer} numberOfLines={4}>
              {item.answer}
            </Text>
            {item.note ? <Text style={styles.note}>{t('adminHelpMetrics.missing', { note: item.note })}</Text> : null}
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing.x3,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
  },
  tileValue: {
    ...baseText.h2,
  },
  tileLabel: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
  },
  tileHint: {
    ...baseText.caption,
    color: colors.textDisabled,
  },
  card: {
    marginTop: spacing.x3,
  },
  cardTitle: {
    ...baseText.body,
    fontWeight: '700',
    marginBottom: spacing.x2,
  },
  meta: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  body: {
    ...baseText.bodySmall,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  barLabel: {
    ...baseText.bodySmall,
    width: 90,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceCardSolid,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.accentPrimaryStrong,
  },
  barValue: {
    ...baseText.bodySmall,
    width: 32,
    textAlign: 'right',
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.x1,
  },
  feedbackItem: {
    paddingVertical: spacing.x2,
    borderTopWidth: borders.hairline,
    borderTopColor: colors.borderSubtle,
    gap: spacing.x1,
  },
  question: {
    ...baseText.bodySmall,
    fontWeight: '700',
  },
  answer: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
  },
  note: {
    ...baseText.caption,
    color: colors.warning,
  },
});
