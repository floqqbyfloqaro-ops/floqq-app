// The way into "Find your group" from the confirmed group: when the "Find my group" button shows,
// when it says the passenger has landed, and what the meetup screen may do in each state.
//
//   - hidden:  no confirmed group (never confirmed, cancelled, dissolved), or the ride has started.
//   - preview: the passenger hasn't landed. The screen shows where and when the group meets, and
//              reads no location at all.
//   - landed:  from the passenger's expected landing on - their flight's latest estimate, or the
//              ride's own arrival time (the server's copy of that rule is
//              supabase/functions/_shared/landedRule.ts). The guidance may run.
//
// No imports, so this runs under a plain Node test.

export type FindGroupEntryState = 'hidden' | 'preview' | 'landed';

// What the rules need of the meetup (see findGroup.ts); null when the ride has no confirmed group.
export type EntryMeetup = {
  rideStartedAt: string | null;
  meetupCompletedAt: string | null;
  members: { isMe: boolean; expectedLandingAt: string }[];
};

export function hasLanded(expectedLandingAt: string, nowMs: number): boolean {
  return nowMs >= new Date(expectedLandingAt).getTime();
}

export function findGroupEntryState(meetup: EntryMeetup | null, nowMs: number): FindGroupEntryState {
  if (!meetup || meetup.rideStartedAt != null) return 'hidden';
  const me = meetup.members.find((member) => member.isMe);
  if (!me) return 'hidden';
  return hasLanded(me.expectedLandingAt, nowMs) ? 'landed' : 'preview';
}

// The phone's location - its own position for the arrow, the compass, sharing with the group - is
// only ever read once the passenger has landed. Never in the preview.
export function locationMayRun(state: FindGroupEntryState): boolean {
  return state === 'landed';
}

// Opening the app goes straight to "Find your group" when the passenger has landed and the group
// hasn't found each other yet - once per ride.
export function shouldAutoOpen(meetup: EntryMeetup | null, nowMs: number, alreadyOpened: boolean): boolean {
  if (alreadyOpened || !meetup || meetup.meetupCompletedAt != null) return false;
  return findGroupEntryState(meetup, nowMs) === 'landed';
}
