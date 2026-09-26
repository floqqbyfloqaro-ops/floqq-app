// Payments prototype, phase 4: the designated payer of a confirmed group (see
// 20260926030000_designated_payer.sql), plus the payer's Stripe Connect payout account.
//
// Payout accounts use Stripe's Accounts v2 API (/v2/core/accounts) - Stripe refuses the older v1
// account creation for new Connect platforms. The stripe@17 SDK the other functions use has no v2
// support, so these few calls go straight to Stripe's REST API.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { rideDepartureMs } from './holdMath.ts';
import { sendPush } from './push.ts';
import { assertTestKey } from './stripe.ts';

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

const STRIPE_V2_VERSION = '2026-08-26.dahlia';

export class StripeV2Error extends Error {
  constructor(public status: number, public code: string | undefined, message: string) {
    super(message);
  }
}

function secretKey(): string {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
  assertTestKey('STRIPE_SECRET_KEY', key);
  return key;
}

// One call to Stripe's v2 API. Throws StripeV2Error with Stripe's own message on a refusal.
export async function stripeV2<T>(
  method: 'GET' | 'POST',
  path: string,
  options: { body?: unknown; query?: string; idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    'Stripe-Version': STRIPE_V2_VERSION,
  };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const response = await fetch(`https://api.stripe.com${path}${options.query ? `?${options.query}` : ''}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new StripeV2Error(response.status, json?.error?.code, json?.error?.message ?? `Stripe returned ${response.status}`);
  }
  return json as T;
}

type CapabilityState = { status?: string; status_details?: { code?: string; resolution?: string }[] } | null | undefined;

export type V2Account = {
  id: string;
  configuration?: {
    recipient?: {
      capabilities?: { stripe_balance?: { stripe_transfers?: CapabilityState; payouts?: CapabilityState } };
    } | null;
  } | null;
  requirements?: {
    entries?: { awaiting_action_from?: string; minimum_deadline?: { status?: string } }[] | null;
  } | null;
};

export function retrievePayoutAccount(accountId: string): Promise<V2Account> {
  return stripeV2<V2Account>('GET', `/v2/core/accounts/${accountId}`, {
    query: 'include[0]=configuration.recipient&include[1]=requirements',
  });
}

// Where the payout account stands: FLOQQ can send it money (COMPLETE); Stripe can't activate it
// without help (RESTRICTED); the payer still has to fill something in (PENDING, not submitted); or
// Stripe is still checking what they sent (PENDING, submitted).
export function payoutStateOf(account: V2Account): { status: PayoutStatus; detailsSubmitted: boolean } {
  const balance = account.configuration?.recipient?.capabilities?.stripe_balance;
  const capabilities = [balance?.stripe_transfers, balance?.payouts].filter((c) => c != null);
  const userMustAct = (account.requirements?.entries ?? []).some(
    (e) => e.awaiting_action_from === 'user' && e.minimum_deadline?.status !== 'eventually_due'
  );

  if (capabilities.length > 0 && capabilities.every((c) => c!.status === 'active')) {
    return { status: 'COMPLETE', detailsSubmitted: true };
  }
  const blocked = capabilities.some(
    (c) => c!.status === 'unsupported' || c!.status_details?.some((d) => d.resolution === 'contact_stripe')
  );
  if (blocked) return { status: 'RESTRICTED', detailsSubmitted: true };
  return { status: 'PENDING', detailsSubmitted: !userMustAct };
}

// Copies a payout account's state into the payer's payment profile.
export async function savePayoutStatus(adminClient: SupabaseClient, userId: string, account: V2Account) {
  const state = payoutStateOf(account);
  await adminClient
    .from('user_payment_profiles')
    .update({ payout_onboarding_status: state.status, payout_details_submitted: state.detailsSubmitted })
    .eq('user_id', userId)
    .eq('stripe_connect_account_id', account.id);
  return state;
}
