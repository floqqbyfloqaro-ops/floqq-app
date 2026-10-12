// What a scheduled job's response says about its run, for the job_runs table the admin dashboard
// reads (see jobRuns.ts).
//
// No Deno-touching imports, so this runs under a plain Node test.

export type JobRunOutcome =
  // Not a run at all: the caller wasn't allowed in, or another run was still going.
  | { kind: 'ignored' }
  // Ran to the end. `problems`: things that went wrong along the way without stopping it.
  | { kind: 'success'; result: unknown; problems: string | null }
  | { kind: 'error'; message: string };

const MAX_ERROR_LENGTH = 500;

const shorten = (text: string) => (text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text);

export function jobRunOutcome(status: number, bodyText: string): JobRunOutcome {
  let body: unknown = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // Not JSON: judged by its status alone.
  }
  const fields = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

  if (status === 401 || status === 403) return { kind: 'ignored' };

  if (status >= 200 && status < 300) {
    // The lock was taken: the run that holds it reports for itself.
    if (fields.skipped === true || fields.skipped === 'already_running') return { kind: 'ignored' };
    const problems = Array.isArray(fields.problems) ? fields.problems.filter((p) => typeof p === 'string') : [];
    return { kind: 'success', result: body, problems: problems.length ? shorten(problems.join('; ')) : null };
  }

  const message = typeof fields.error === 'string' && fields.error ? fields.error : bodyText || `HTTP ${status}`;
  return { kind: 'error', message: shorten(message) };
}
