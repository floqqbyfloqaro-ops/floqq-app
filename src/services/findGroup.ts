import type { BadgeColor } from '../theme/badgePalette';
import type { MeetingPointSummary } from './meetingPointRules';
import { supabase } from './supabase';

export type MeetupMember = {
  // The member's ride id - what their live position is labelled with on the group's channel.
  requestId: string;
  isMe: boolean;
  firstName: string | null;
  // Their chosen avatar; null: the neutral default.
  avatarId: number | null;
  // When this member lands: their flight's latest estimate, otherwise their ride's arrival time.
  expectedLandingAt: string;
  // When this member confirmed "I've found my group"; null: not yet.
  foundAt: string | null;
  // When this member said (or their phone detected) they are at the meeting point; null: not there.
  arrivedAt: string | null;
};

export type MeetupBadge = { color: BadgeColor; number: number };

export type Meetup = {
  groupId: string;
  // 'T1' / 'T2' - the one terminal everyone in the group arrives at. Null only on old groups.
  terminal: string | null;
  // Where the group meets: its own point, or until that is saved (within a minute of
  // confirmation) the terminal's fallback. Null only when the terminal is unknown.
  meetingPoint: MeetingPointSummary | null;
  // The point above is the terminal's fallback, handed out before the group's own was saved.
  meetingPointProvisional: boolean;
  meetingTime: string;
  // The group's badge: assigned within a minute of confirmation and never changed after.
  badge: MeetupBadge | null;
  // Set once every member has confirmed "I've found my group": the meetup is done.
  meetupCompletedAt: string | null;
  // From this moment the members who confirmed may continue without whoever hasn't. Null until
  // someone has confirmed.
  continueWithoutFrom: string | null;
  // Set once the ride has started: the meetup is over.
  rideStartedAt: string | null;
  // The first member's landing time: location sharing is possible from then on.
  windowOpensAt: string;
  departureAt: string;
  // Safety timeout: sharing switches itself off at this moment.
  sharingEndsAt: string;
  members: MeetupMember[];
};

// The passenger's confirmed group as they may see it for the meetup (find-group Edge Function - a
// passenger can't read the other passengers' rides themselves). meetup is null when the ride has
// no confirmed group (any more).
export async function fetchMeetup(requestId: string) {
  const { data, error } = await supabase.functions.invoke('find-group', { body: { requestId } });
  if (error) return { meetup: null as Meetup | null, error };
  return { meetup: (data?.meetup ?? null) as Meetup | null, error: null };
}

// "I'm at the meeting point" (MANUAL - the primary signal, whatever the GPS says) or the phone's
// own detection (AUTO). Records when and how, never where.
export async function markArrived(requestId: string, source: 'MANUAL' | 'AUTO') {
  const { data, error } = await supabase.rpc('member_mark_arrived', { p_request_id: requestId, p_source: source });
  if (error) return { ok: false, error: error.message };
  const result = data as { arrived: boolean; reason?: string };
  return { ok: result.arrived, error: result.arrived ? null : (result.reason ?? 'not_arrived') };
}

// "Undo": takes the arrival back, until the ride starts.
export async function undoArrival(requestId: string) {
  const { data, error } = await supabase.rpc('member_undo_arrival', { p_request_id: requestId });
  if (error) return { ok: false, error: error.message };
  const result = data as { undone: boolean; reason?: string };
  return { ok: result.undone, error: result.undone ? null : (result.reason ?? 'not_undone') };
}

// "I've found my group": each member confirms for themselves. The group is found once all have.
export async function confirmFound(requestId: string) {
  const { data, error } = await supabase.rpc('member_confirm_found', { p_request_id: requestId });
  if (error) return { ok: false, error: error.message };
  const result = data as { confirmed: boolean; reason?: string };
  return { ok: result.confirmed, error: result.confirmed ? null : (result.reason ?? 'not_confirmed') };
}

// "We're in the taxi": marks the ride as started. Only once the group has been found.
export async function startRide(requestId: string) {
  const { data, error } = await supabase.rpc('member_start_ride', { p_request_id: requestId });
  if (error) return { ok: false, error: error.message };
  const result = data as { started: boolean; reason?: string };
  return { ok: result.started, error: result.started ? null : (result.reason ?? 'not_started') };
}

// "Continue without [name]" (meetup-actions Edge Function): leaves behind a member who never
// showed up. They are marked as a no-show and removed, and the fare estimate is recalculated for
// whoever is left. Refused while the wait isn't over or if fewer than two passengers would remain.
export async function continueWithout(requestId: string, targetRequestId: string) {
  const { error } = await supabase.functions.invoke('meetup-actions', {
    body: { action: 'continue_without', requestId, targetRequestId },
  });
  if (!error) return { ok: true, error: null as string | null };
  const context = (error as { context?: Response }).context;
  const body = context ? await context.json().catch(() => null) : null;
  return { ok: false, error: (body?.error as string | undefined) ?? 'continue_failed' };
}

export type FindGroupOpenSource = 'button' | 'notification' | 'app_open';

// Audit trail: that the passenger opened "Find your group", in which state and how they got there
// - never where they are. Best effort: the screen doesn't depend on it.
export async function logFindGroupOpened(requestId: string, state: 'preview' | 'landed', source: FindGroupOpenSource) {
  const { error } = await supabase.rpc('log_find_group_opened', {
    p_request_id: requestId,
    p_state: state,
    p_source: source,
  });
  if (error) console.warn('log_find_group_opened failed', error.message);
}

export type SharingStopReason = 'user' | 'background' | 'left_screen' | 'timeout' | 'group_ended' | 'permission';

// Audit trail: that sharing started or stopped, and why - never where the passenger is. Best
// effort: sharing itself doesn't depend on it.
export async function logLocationSharing(
  requestId: string,
  event: 'location_sharing_started' | 'location_sharing_stopped',
  reason?: SharingStopReason
) {
  const { error } = await supabase.rpc('log_location_sharing', {
    p_request_id: requestId,
    p_event: event,
    p_reason: reason ?? null,
  });
  if (error) console.warn('log_location_sharing failed', error.message);
}
