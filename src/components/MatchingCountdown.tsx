import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { DEFAULT_MATCHING_SCHEDULE, fetchMatchingSchedule, MatchingSchedule } from '../services/matchingSchedule';
import { formatCountdown, matchingCountdown } from '../services/matchingScheduleRules';
import { baseText, colors, spacing } from '../theme/colors';

// How often the schedule is read again: quickly while a check is running (to see it finish),
// otherwise now and then, to stay in step with the server.
const CHECKING_POLL_MS = 3_000;
const RESYNC_MS = 60_000;

// "Finding your match": how often matches are checked, and a countdown to the next check. A
// component of its own on purpose - it re-renders every second, and the screen around it (the
// pulsing logo) must not. Promises nothing about how long a match takes.
export default function MatchingCountdown() {
  const { t } = useTranslation();
  const [schedule, setSchedule] = useState<MatchingSchedule>(DEFAULT_MATCHING_SCHEDULE);
  const [now, setNow] = useState(() => Date.now());
  const lastFetchAt = useRef(0);
  const isFetching = useRef(false);

  const countdown = matchingCountdown(now + schedule.clockOffsetMs, schedule.intervalMinutes, schedule.lastRunAtMs);
  const isChecking = countdown.kind === 'checking';
  // Read by the timer below, which is set up once.
  const isCheckingRef = useRef(isChecking);
  isCheckingRef.current = isChecking;

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      if (isFetching.current) return;
      isFetching.current = true;
      lastFetchAt.current = Date.now();
      const next = await fetchMatchingSchedule();
      isFetching.current = false;
      if (!cancelled && next) setSchedule(next);
    };

    refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      const wait = isCheckingRef.current ? CHECKING_POLL_MS : RESYNC_MS;
      if (Date.now() - lastFetchAt.current >= wait) refresh();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.explainer}>{t('matching_interval_explainer', { minutes: schedule.intervalMinutes })}</Text>
      {/* Not announced by screen readers every second: read when focused, like any other text. */}
      <Text style={styles.countdown}>
        {isChecking
          ? t('matching_checking_now')
          : t('matching_next_check', { time: formatCountdown(countdown.secondsLeft) })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    marginBottom: spacing.x8,
  },
  explainer: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x2,
  },
  countdown: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
    // Digits of equal width, so the line doesn't shift as the seconds change.
    fontVariant: ['tabular-nums'],
  },
});
