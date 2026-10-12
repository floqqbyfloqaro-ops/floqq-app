import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { jobHealth, jobNeedsAttention, JobRun, overdueAfterMinutes, SCHEDULED_JOBS } from '../services/jobRunRules';
import { supabase } from '../services/supabase';
import { baseText, colors, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import Card from './Card';

type Props = {
  // Reloads when this changes (the dashboard's pull-to-refresh).
  refreshKey?: number;
};

// How often the "no successful run for a while" check is redone while the dashboard stays open.
const CLOCK_TICK_MS = 30_000;

// Admin dashboard: the scheduled jobs (matching, offers, flights, payments) with each one's last
// successful run and last error, so a job that fails - or silently stops - is seen. Only the
// admin can read job_runs (row level security).
export default function AdminJobStatus({ refreshKey = 0 }: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<JobRun[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('job_runs')
      .select('job, last_success_at, last_error_at, last_error')
      .returns<JobRun[]>();
    if (error) {
      console.warn('loading the job runs failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setRuns(data ?? []);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (loadFailed) {
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>{t('adminJobs.title')}</Text>
        <Text style={styles.warning}>{t('adminJobs.loadError')}</Text>
      </Card>
    );
  }
  if (!runs) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t('adminJobs.title')}</Text>
      {SCHEDULED_JOBS.map((job) => {
        const health = jobHealth(
          job,
          runs.find((run) => run.job === job.job),
          now
        );
        const attention = jobNeedsAttention(health);
        return (
          <View key={job.job} style={styles.job}>
            <Text style={[styles.jobName, attention && styles.warning]}>{t(`adminJobs.job.${job.job}`)}</Text>
            <Text style={health.state === 'ok' ? styles.line : styles.warning}>
              {health.state === 'never'
                ? t('adminJobs.never')
                : health.state === 'overdue'
                  ? t('adminJobs.overdue', {
                      date: formatBarcelonaDateTime(health.lastSuccessAt as string),
                      minutes: overdueAfterMinutes(job.everyMinutes),
                    })
                  : t('adminJobs.lastSuccess', { date: formatBarcelonaDateTime(health.lastSuccessAt as string) })}
            </Text>
            {health.lastError && health.lastErrorAt ? (
              <Text style={health.errorIsCurrent ? styles.warning : styles.line}>
                {t('adminJobs.lastError', {
                  date: formatBarcelonaDateTime(health.lastErrorAt),
                  error: health.lastError,
                })}
              </Text>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.x4,
  },
  title: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  job: {
    marginBottom: spacing.x3,
  },
  jobName: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  line: {
    ...baseText.caption,
    color: colors.info,
  },
  warning: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
  },
});
