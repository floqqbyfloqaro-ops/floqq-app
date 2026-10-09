// The life of an offer ("Match found"): a group the matching job proposed that isn't confirmed
// yet. Its passengers each secure their spot or leave it, within a response window; when
// everyone left in it has secured, the group confirms itself. Used by match-and-group (a new
// offer), secure-spot / payments-place-hold / stripe-webhook (a spot was secured), decline-match
// ("Not for me") and match-offer-sweep (the response window). See
// 20261008010000_match_offer_answers.sql.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17';

import { MATCH_OFFER_TIMEOUT_MINUTES } from './constants.ts';
import { sendDueHoldNotifications, syncGroupHolds } from './holds.ts';
import { syncGroupPayer } from './payer.ts';
import { sendPush } from './push.ts';
import { rescoreGroup } from './rescoreGroup.ts';
import { createStripeClient, paymentsEnabled } from './stripe.ts';

const MINUTE_MS = 60_000;

export function offerExpiresAt(now: Date): string {
  return new Date(now.getTime() + MATCH_OFFER_TIMEOUT_MINUTES * MINUTE_MS).toISOString();
}

// Stripe for the functions that only need it to keep holds in step: null with payments off or
// not usable - the offer itself never depends on it.
export function stripeForOffers(): Stripe | null {
  if (!paymentsEnabled()) return null;
  try {
    return createStripeClient();
  } catch (err) {
    console.error('Stripe not usable for offers', err);
    return null;
  }
}

// Starts an offer's response window and tells its passengers, once: only the caller that sets
// offer_expires_at announces it.
export async function announceOffer(adminClient: SupabaseClient, groupId: string, now = new Date()): Promise<boolean> {
  const expiresAt = offerExpiresAt(now);
  const { data: started } = await adminClient
    .from('taxi_groups')
    .update({ offer_expires_at: expiresAt })
    .eq('id', groupId)
    .eq('status', 'unconfirmed')
    .is('offer_expires_at', null)
    .select('id');
  if (!started?.length) return false;

  const { data: members } = await adminClient.from('passenger_requests').select('id, user_id').eq('group_id', groupId);

  await adminClient.from('group_events').insert({
    group_id: groupId,
    event_type: 'match_offered',
    details: { request_ids: (members ?? []).map((m) => m.id), expires_at: expiresAt },
    actor_type: 'system',
  });

  for (const member of members ?? []) {
    if (member.user_id) await sendPush(adminClient, { userId: member.user_id, key: 'matchFound', timeIso: expiresAt });
  }
  return true;
}

// Confirms the group once every passenger in it has secured their spot. With payments on, the
// usual confirmed-group bookkeeping follows right away (holds, the designated payer, and
// "reserve your seat" for anyone whose hold couldn't be placed yet).
export async function confirmOfferIfComplete(
  adminClient: SupabaseClient,
  stripe: Stripe | null,
  groupId: string,
  now = new Date()
): Promise<boolean> {
  const { data: members } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, distance_km, spot_secured_group_id')
    .eq('group_id', groupId);
  if (!members || members.length < 2) return false;
  // distance_km is missing while a rescore after someone left is still to be applied.
  if (members.some((m) => m.spot_secured_group_id !== groupId || m.distance_km == null)) return false;

  const { data: confirmed } = await adminClient
    .from('taxi_groups')
    .update({ status: 'confirmed' })
    .eq('id', groupId)
    .eq('status', 'unconfirmed')
    .select('id');
  if (!confirmed?.length) return false;

  for (const member of members) {
    if (member.user_id) await sendPush(adminClient, { userId: member.user_id, key: 'groupConfirmed' });
  }

  if (stripe) {
    try {
      await syncGroupHolds(adminClient, stripe, groupId, now);
      await syncGroupPayer(adminClient, groupId, now);
      await sendDueHoldNotifications(adminClient, now, groupId);
    } catch (err) {
      // The 5-minute payments-sync-holds job does the same for every confirmed group.
      console.error('payments sync after confirming an offer failed', err);
    }
  }
  return true;
}

export type OfferRemoval = { removed: boolean; dissolved: boolean };

// Takes one passenger out of an offer and puts their ride back to searching: "Not for me"
// ('match_declined'), no answer in time ('offer_expired'), or their flight now lands at another
// terminal than the group's ('terminal_changed'). What's left is rescored - or
// dissolved, below two passengers or when it no longer fits - and with payments on the leaver's
// hold is released and the others' adjusted.
export async function removeFromOffer(
  adminClient: SupabaseClient,
  stripe: Stripe | null,
  groupId: string,
  requestId: string,
  event: 'match_declined' | 'offer_expired' | 'terminal_changed'
): Promise<OfferRemoval> {
  const { data, error } = await adminClient.rpc('system_remove_offer_member', {
    p_group_id: groupId,
    p_request_id: requestId,
    p_event: event,
  });
  if (error) {
    console.error('system_remove_offer_member failed', error);
    return { removed: false, dissolved: false };
  }

  const result = data as {
    blocked: boolean;
    needs_recalc?: boolean;
    dissolved?: boolean;
    group_version?: number;
    remaining_ids?: string[];
  };
  if (result.blocked) return { removed: false, dissolved: false };

  if (result.needs_recalc && result.group_version != null) {
    await rescoreGroup(adminClient, groupId, result.group_version);
  }

  // Passengers with a hold hear "group dissolved" from syncGroupHolds; the others from here.
  let alreadyTold = new Set<string>();
  if (stripe) {
    try {
      const { data: rows } = await adminClient.from('ride_payments').select('request_id').eq('group_id', groupId);
      alreadyTold = new Set((rows ?? []).map((r) => r.request_id as string));
      await syncGroupHolds(adminClient, stripe, groupId);
    } catch (err) {
      // The 5-minute payments-sync-holds job retries this.
      console.error('syncGroupHolds after leaving an offer failed', err);
    }
  }
  if (result.dissolved && result.remaining_ids?.length) {
    const { data: remaining } = await adminClient
      .from('passenger_requests')
      .select('id, user_id')
      .in('id', result.remaining_ids);
    for (const member of remaining ?? []) {
      if (member.user_id && !alreadyTold.has(member.id)) {
        await sendPush(adminClient, { userId: member.user_id, key: 'groupDissolved' });
      }
    }
  }

  return { removed: true, dissolved: result.dissolved === true };
}
