// Keeps offers ("Match found": unconfirmed groups) moving. Runs every minute (pg_cron):
//   1. Starts the response window of any offer that doesn't have one yet - groups the admin made
//      by hand, or made before this existed - and tells its passengers.
//   2. Acts on offers whose window ran out. Passengers who didn't secure their spot are removed
//      and their rides go back to searching (offer_expired), so nobody who did secure is kept
//      waiting. If nobody secured at all, nobody is waiting on anybody: the window simply starts
//      again, instead of dissolving the group only for the matching job to form it again.
//   3. Confirms offers in which everyone has secured their spot (normally done the moment the
//      last one does - this catches a group that became complete because someone else left).
//   4. Gives confirmed groups their meeting point and badge, and closes meetups that are long over
//      (_shared/meetingPoints.ts) - here, under this job's lock, so two groups are never handed the
//      same point or badge at the same moment.
// Deployed with --no-verify-jwt: authenticates via the cron secret header or the admin's JWT
// (see _shared/auth.ts), like match-and-group.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { isAuthorized } from '../_shared/auth.ts';
import { ADMIN_EMAIL } from '../_shared/constants.ts';
import { acquireLock, releaseLock } from '../_shared/matchLock.ts';
import { runMeetupUpkeep } from '../_shared/meetingPoints.ts';
import { announceOffer, confirmOfferIfComplete, offerExpiresAt, removeFromOffer, stripeForOffers } from '../_shared/offers.ts';
import { sendPush } from '../_shared/push.ts';

const LOCK_ID = 5;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (!(await isAuthorized(req, adminClient, ADMIN_EMAIL))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (!(await acquireLock(adminClient, LOCK_ID))) {
    return jsonResponse({ skipped: 'already_running' });
  }

  try {
    const now = new Date();
    const stripe = stripeForOffers();

    const { data: offers, error } = await adminClient
      .from('taxi_groups')
      .select('id, offer_expires_at')
      .eq('status', 'unconfirmed');
    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    let announced = 0;
    let removed = 0;
    let extended = 0;
    let confirmed = 0;

    for (const offer of offers ?? []) {
      if (!offer.offer_expires_at) {
        if (await announceOffer(adminClient, offer.id, now)) announced += 1;
        continue;
      }
      if (new Date(offer.offer_expires_at).getTime() > now.getTime()) continue;

      const { data: members } = await adminClient
        .from('passenger_requests')
        .select('id, user_id, spot_secured_group_id')
        .eq('group_id', offer.id);
      if (!members?.length) continue;

      const unanswered = members.filter((m) => m.spot_secured_group_id !== offer.id);
      if (unanswered.length === members.length) {
        await adminClient
          .from('taxi_groups')
          .update({ offer_expires_at: offerExpiresAt(now) })
          .eq('id', offer.id)
          .eq('status', 'unconfirmed');
        extended += 1;
        continue;
      }

      for (const member of unanswered) {
        const result = await removeFromOffer(adminClient, stripe, offer.id, member.id, 'offer_expired');
        if (!result.removed) continue;
        removed += 1;
        if (member.user_id) await sendPush(adminClient, { userId: member.user_id, key: 'offerExpired' });
      }
    }

    for (const offer of offers ?? []) {
      if (await confirmOfferIfComplete(adminClient, stripe, offer.id, now)) confirmed += 1;
    }

    // Confirmed groups - the ones just confirmed above included - get their meeting point and
    // badge, and meetups that are long over are closed.
    const meetups = await runMeetupUpkeep(adminClient, now);

    return jsonResponse({ announced, removed, extended, confirmed, meetups });
  } finally {
    await releaseLock(adminClient, LOCK_ID);
  }
});
