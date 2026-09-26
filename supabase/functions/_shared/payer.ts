// Payments prototype, phase 4: the designated payer of a confirmed group (see
// 20260926030000_designated_payer.sql), plus the payer's Stripe Connect payout account.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type Stripe from 'npm:stripe@17';

import { rideDepartureMs } from './holdMath.ts';
import { sendPush } from './push.ts';

// One "set up your payout" reminder this long before the ride, if the payer hasn't finished yet -
// but never within PAYER_REMINDER_MIN_AFTER_ASSIGN_MINUTES of the "you're paying" notification.
const PAYER_REMINDER_BEFORE_RIDE_MINUTES = 180;
const PAYER_REMINDER_MIN_AFTER_ASSIGN_MINUTES = 30;
const MINUTE_MS = 60_000;

export type PayoutStatus = 'NOT_STARTED' | 'PENDING' | 'COMPLETE' | 'RESTRICTED';

// Keeps the group's payer valid (picks one right after confirmation, or a new one if the payer
// left the group) and sends the notifications that go with it. Never throws.
export async function syncGroupPayer(adminClient: SupabaseClient, groupId: string, now = new Date()): Promise<void> {
  try {
    const { data, error } = await adminClient.rpc('system_assign_group_payer', { p_group_id: groupId });
    if (error) {
      console.error('system_assign_group_payer failed', error);
      return;
    }
    const result = data as { changed: boolean; user_id?: string };
    if (result.changed && result.user_id) {
      await sendPush(adminClient, { userId: result.user_id, key: 'payerAssigned' });
      return;
    }
    await sendPayerReminderIfDue(adminClient, groupId, now);
  } catch (err) {
    console.error('syncGroupPayer failed', err);
  }
}

async function sendPayerReminderIfDue(adminClient: SupabaseClient, groupId: string, now: Date): Promise<void> {
  const { data: group } = await adminClient
    .from('taxi_groups')
    .select('payer_user_id, payer_assigned_at, payer_reminder_sent_at')
    .eq('id', groupId)
    .single();
  if (!group?.payer_user_id || group.payer_reminder_sent_at) return;
  if (group.payer_assigned_at && now.getTime() - new Date(group.payer_assigned_at).getTime() < PAYER_REMINDER_MIN_AFTER_ASSIGN_MINUTES * MINUTE_MS) {
    return;
  }

  const { data: members } = await adminClient.from('passenger_requests').select('arrival_at').eq('group_id', groupId);
  if (!members?.length) return;
  const rideMs = rideDepartureMs(members.map((m) => m.arrival_at));
  if (rideMs - now.getTime() > PAYER_REMINDER_BEFORE_RIDE_MINUTES * MINUTE_MS) return;

  const { data: profile } = await adminClient
    .from('user_payment_profiles')
    .select('payout_onboarding_status')
    .eq('user_id', group.payer_user_id)
    .maybeSingle();
  if (profile?.payout_onboarding_status === 'COMPLETE') return;

  // Claim the reminder first, so two overlapping runs can't both send it.
  const { data: claimed } = await adminClient
    .from('taxi_groups')
    .update({ payer_reminder_sent_at: now.toISOString() })
    .eq('id', groupId)
    .eq('payer_user_id', group.payer_user_id)
    .is('payer_reminder_sent_at', null)
    .select('id');
  if (!claimed?.length) return;

  await sendPush(adminClient, { userId: group.payer_user_id, key: 'payerSetupReminder' });
}

// Where the connected account stands: payouts can be sent (COMPLETE), Stripe needs more from the
// payer (RESTRICTED), or the payer hasn't finished / Stripe is still checking (PENDING).
export function payoutStatusOf(account: Stripe.Account): PayoutStatus {
  if (account.payouts_enabled && account.capabilities?.transfers === 'active') return 'COMPLETE';
  const due = [...(account.requirements?.currently_due ?? []), ...(account.requirements?.past_due ?? [])];
  if (account.details_submitted && due.length > 0) return 'RESTRICTED';
  return 'PENDING';
}

// Copies a connected account's state into the payer's payment profile.
export async function savePayoutStatus(adminClient: SupabaseClient, userId: string, account: Stripe.Account) {
  const status = payoutStatusOf(account);
  await adminClient
    .from('user_payment_profiles')
    .update({ payout_onboarding_status: status, payout_details_submitted: account.details_submitted ?? false })
    .eq('user_id', userId)
    .eq('stripe_connect_account_id', account.id);
  return { status, detailsSubmitted: account.details_submitted ?? false };
}
