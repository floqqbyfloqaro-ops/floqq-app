import type { MeetingPointSummary } from './meetingPointRules';
import { supabase } from './supabase';

export type MeetupMember = {
  // The member's ride id - what their live position is labelled with on the group's channel.
  requestId: string;
  isMe: boolean;
  firstName: string | null;
};

export type Meetup = {
  groupId: string;
  // 'T1' / 'T2' - the one terminal everyone in the group arrives at. Null only on old groups.
  terminal: string | null;
  // Where the group meets. Null until one is assigned (within a minute of confirmation, provided
  // the terminal has an active point).
  meetingPoint: MeetingPointSummary | null;
  meetingTime: string;
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
