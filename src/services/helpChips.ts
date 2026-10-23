// The help screen's suggested questions, which follow where the passenger's ride is. Each chip is a
// topic: its question text is in the app's languages (help.chip.<topic>), and when the assistant
// can't be reached the help-chat function answers it from the knowledge base (HELP_TOPICS in
// supabase/functions/_shared/helpChatRules.ts - keep the names in sync). No imports, so a plain
// Node test (helpChips.test.mjs) runs it.

export type HelpTopic =
  | 'why_no_match'
  | 'change_ride'
  | 'fee'
  | 'cancel'
  | 'find_group'
  | 'arrow'
  | 'refund'
  | 'share_wrong'
  | 'how_it_works'
  | 'cost';

export type HelpRideStage = 'searching' | 'matched' | 'meetup' | 'completed' | 'none';

export type HelpRideFacts = {
  status: 'pending' | 'matched' | 'cancelled' | 'expired';
  arrivalAt: string;
  readyAt: string | null;
  completedAt: string | null;
  groupStatus: 'unconfirmed' | 'confirmed' | 'dissolved' | null;
  rideStartedAt: string | null;
};

const HOUR_MS = 60 * 60_000;
// As on the server: from 3 hours before the meeting the passenger is "at the airport".
const MEETUP_BEFORE_HOURS = 3;
// A ride that ended is still the context for a day.
const RECENT_HOURS = 24;

export function rideStage(ride: HelpRideFacts | null, nowMs: number): HelpRideStage {
  if (!ride) return 'none';
  if (ride.completedAt) return nowMs - Date.parse(ride.completedAt) <= RECENT_HOURS * HOUR_MS ? 'completed' : 'none';
  if (ride.status === 'cancelled' || ride.status === 'expired') return 'none';
  if (ride.status === 'pending' || !ride.groupStatus || ride.groupStatus === 'dissolved') return 'searching';
  if (ride.groupStatus === 'confirmed') {
    const meetMs = Date.parse(ride.readyAt ?? ride.arrivalAt);
    if (ride.rideStartedAt || meetMs <= nowMs + MEETUP_BEFORE_HOURS * HOUR_MS) return 'meetup';
  }
  return 'matched';
}

const CHIPS: Record<HelpRideStage, HelpTopic[]> = {
  searching: ['why_no_match', 'change_ride'],
  matched: ['fee', 'cancel'],
  meetup: ['find_group', 'arrow'],
  completed: ['refund', 'share_wrong'],
  none: ['how_it_works', 'cost'],
};

export function chipsFor(stage: HelpRideStage): HelpTopic[] {
  return CHIPS[stage];
}

// The context card's status pill, in the app's usual badge styles.
export function stagePill(stage: HelpRideStage): 'Searching' | 'Group Confirmed' | 'Driver En Route' | null {
  return stage === 'searching' ? 'Searching' : stage === 'matched' ? 'Group Confirmed' : stage === 'meetup' || stage === 'completed' ? 'Driver En Route' : null;
}
