// The help screen's suggested questions, which follow where the passenger's ride is. Each chip is a
// topic: its question text is in the app's languages (help.chip.<topic>), and when the assistant
// can't be reached the help-chat function answers it from the knowledge base (HELP_TOPICS in
// supabase/functions/_shared/helpChatRules.ts - keep the names in sync). No imports, so a plain
// Node test (helpChips.test.mjs) runs it.

// Every suggested question, by theme - "More topics" shows them all in this order.
export const TOPIC_GROUPS = {
  ride: ['cancel', 'change_ride', 'why_no_match', 'how_matching', 'flight_delayed'],
  meetup: ['meeting_point', 'find_group', 'arrow', 'someone_missing'],
  money: ['cost', 'who_pays', 'fare_split', 'refund', 'payment_failed'],
  account: ['change_password', 'no_email', 'change_email'],
  general: ['how_it_works', 'is_it_safe'],
} as const;

export type HelpTopicGroup = keyof typeof TOPIC_GROUPS;
export type HelpTopic = (typeof TOPIC_GROUPS)[HelpTopicGroup][number];
export const ALL_TOPICS: HelpTopic[] = Object.values(TOPIC_GROUPS).flat();

// After an answer the assistant may also suggest "Book a new ride": a chip that opens the new
// ride screen rather than asking a question.
export const BOOK_NEW_RIDE = 'book_new_ride';
export type HelpFollowup = HelpTopic | typeof BOOK_NEW_RIDE;

export function isFollowup(value: unknown): value is HelpFollowup {
  return value === BOOK_NEW_RIDE || (ALL_TOPICS as string[]).includes(value as string);
}

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

// The chips at the start of a conversation, most relevant first for where the ride is (the screen
// adds "More topics" after them). A group that is found but not meeting yet gets the questions
// that matter before the airport.
const CHIPS: Record<HelpRideStage, HelpTopic[]> = {
  none: ['how_it_works', 'cost', 'who_pays', 'fare_split', 'is_it_safe', 'change_password'],
  searching: ['why_no_match', 'change_ride', 'cancel', 'flight_delayed', 'how_matching'],
  matched: ['meeting_point', 'who_pays', 'fare_split', 'cancel', 'flight_delayed', 'cost'],
  meetup: ['meeting_point', 'find_group', 'arrow', 'someone_missing', 'cancel'],
  completed: ['refund', 'fare_split', 'payment_failed'],
};

export function chipsFor(stage: HelpRideStage): HelpTopic[] {
  return CHIPS[stage];
}

// The context card's status pill, in the app's usual badge styles.
export function stagePill(stage: HelpRideStage): 'Searching' | 'Group Confirmed' | 'Driver En Route' | null {
  return stage === 'searching' ? 'Searching' : stage === 'matched' ? 'Group Confirmed' : stage === 'meetup' || stage === 'completed' ? 'Driver En Route' : null;
}
