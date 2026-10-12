// Pure decision logic for a late join: may a waiting passenger be added to a group that is still
// an offer? (lateJoin.ts glues this to the database, Google Routes and the notifications.)
//
// Like groupRebalance.ts this has no Deno-touching imports, so it runs under a plain Node test
// (lateJoinRule.test.ts).

import type { DetourLimits } from './detourLimit.ts';
import { groupRejection } from './groupRebalance.ts';
import type { GroupRejection, SuggestionLike } from './groupRebalance.ts';
import { waitOverLimit, waitsFit } from './readyTimeRule.ts';
import type { WaitingRide } from './readyTimeRule.ts';

export type JoinMember = {
  id: string;
  // When they can leave the airport (see readyTimeRule.ts) - not when their plane arrives.
  readyAt: string;
  largeLuggageCount: number;
  maxWaitMinutes: number;
};

const asWaitingRide = (m: JoinMember): WaitingRide => ({
  id: m.id,
  arrival_at: m.readyAt,
  ready_at: m.readyAt,
  max_wait_minutes: m.maxWaitMinutes,
});

export type JoinRejection =
  | GroupRejection
  | { reason: 'arrival_window'; request_id: string }
  | { reason: 'share_would_rise'; request_id: string; current_cents: number; new_cents: number };

// Same pairwise rule the matching job uses when it forms a group: whoever is ready first would
// wait for the other no longer than their own maximum wait. A cheap first filter - the group as a
// whole is checked in joinRejection.
export function readyTimesCompatible(a: JoinMember, b: JoinMember): boolean {
  return waitsFit([asWaitingRide(a), asWaitingRide(b)]);
}

// The enlarged group must pass every rule a group has to pass (route found, large luggage, each
// passenger's own detour and wait), and nobody already in the group may end up with a higher
// estimated share than they have now - a late join should only ever make the ride cheaper for
// the passengers who were offered it (and may have secured it) at the current price.
// `suggestion` is the enlarged group's score; `currentSharesCents` the existing members' shares.
// Returns the first rule that fails, or null when the passenger may join.
export function joinRejection(
  suggestion: SuggestionLike | null,
  existing: JoinMember[],
  newcomer: JoinMember,
  currentSharesCents: Map<string, number>,
  maxLargeLuggagePerTaxi: number,
  detourLimits: DetourLimits
): JoinRejection | null {
  // With the newcomer the group meets when its last member is ready: every member's own wait
  // until then must fit their own maximum.
  const overLimit = waitOverLimit([...existing, newcomer].map(asWaitingRide));
  if (overLimit) return { reason: 'arrival_window', request_id: overLimit.request_id };

  const rejection = groupRejection(suggestion, [...existing, newcomer], maxLargeLuggagePerTaxi, detourLimits);
  if (rejection) return rejection;

  for (const member of existing) {
    const current = currentSharesCents.get(member.id);
    const scored = suggestion!.members.find((m) => m.id === member.id);
    if (current == null || !scored) return { reason: 'route_lookup_failed' };
    const next = Math.round(scored.fareAmount * 100);
    if (next > current) {
      return { reason: 'share_would_rise', request_id: member.id, current_cents: current, new_cents: next };
    }
  }
  return null;
}
