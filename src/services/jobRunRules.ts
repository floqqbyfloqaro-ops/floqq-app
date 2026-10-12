// How the scheduled jobs are doing, for the admin dashboard. Each job records its last successful
// run and its last error (supabase/functions/_shared/jobRuns.ts); a job that crashes before it can
// record anything, or never starts, shows up here as one that hasn't succeeded for too long.
//
// No imports, so this runs under a plain Node test.

export type JobRun = {
  job: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
};

// The jobs and how often each is scheduled to run, in minutes.
export const SCHEDULED_JOBS: { job: string; everyMinutes: number }[] = [
  { job: 'match-and-group', everyMinutes: 1 },
  { job: 'match-offer-sweep', everyMinutes: 1 },
  { job: 'recheck-landing-times', everyMinutes: 5 },
  { job: 'payments-sync-holds', everyMinutes: 5 },
  { job: 'payments-settle-rides', everyMinutes: 5 },
];

// A job is overdue once it hasn't succeeded for three of its own intervals - and never sooner
// than five minutes, so one slow run doesn't raise a warning.
export function overdueAfterMinutes(everyMinutes: number): number {
  return Math.max(5, everyMinutes * 3);
}

export type JobHealth = {
  job: string;
  // 'ok': succeeded recently. 'overdue': no recent success. 'never': no run recorded yet.
  state: 'ok' | 'overdue' | 'never';
  lastSuccessAt: string | null;
  // The last error, with whether it happened after the last success (the job is failing now).
  lastErrorAt: string | null;
  lastError: string | null;
  errorIsCurrent: boolean;
};

export function jobHealth(job: { job: string; everyMinutes: number }, run: JobRun | undefined, nowMs: number): JobHealth {
  const successMs = run?.last_success_at ? new Date(run.last_success_at).getTime() : null;
  const errorMs = run?.last_error_at ? new Date(run.last_error_at).getTime() : null;
  const state =
    successMs == null
      ? 'never'
      : nowMs - successMs > overdueAfterMinutes(job.everyMinutes) * 60_000
        ? 'overdue'
        : 'ok';
  return {
    job: job.job,
    state,
    lastSuccessAt: run?.last_success_at ?? null,
    lastErrorAt: run?.last_error_at ?? null,
    lastError: run?.last_error ?? null,
    errorIsCurrent: errorMs != null && (successMs == null || errorMs >= successMs),
  };
}

// Whether the dashboard should draw attention to this job.
export function jobNeedsAttention(health: JobHealth): boolean {
  return health.state !== 'ok' || health.errorIsCurrent;
}
