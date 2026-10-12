// Wraps a scheduled job so that every run leaves a trace in job_runs: when it last succeeded, and
// its last error. The admin dashboard shows both, and warns when a job hasn't succeeded for a
// while - which is also how a job that never even starts gets noticed.
//
// Recording never changes what the job answers, and a failure to record is only logged.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { jobRunOutcome } from './jobRunRule.ts';

async function record(job: string, fields: Record<string, unknown>): Promise<void> {
  try {
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error } = await adminClient.from('job_runs').upsert({ job, ...fields });
    if (error) console.warn(`recording the ${job} run failed`, error.message);
  } catch (err) {
    console.warn(`recording the ${job} run failed`, err);
  }
}

export function monitored(job: string, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    let response: Response;
    try {
      response = await handler(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${job} crashed`, err);
      await record(job, { last_error_at: new Date().toISOString(), last_error: message.slice(0, 500) });
      return new Response(JSON.stringify({ error: 'The run failed.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const outcome = jobRunOutcome(response.status, await response.clone().text());
    const nowIso = new Date().toISOString();
    if (outcome.kind === 'success') {
      await record(job, {
        last_success_at: nowIso,
        last_result: outcome.result,
        ...(outcome.problems ? { last_error_at: nowIso, last_error: outcome.problems } : {}),
      });
    } else if (outcome.kind === 'error') {
      await record(job, { last_error_at: nowIso, last_error: outcome.message });
    }
    return response;
  };
}
