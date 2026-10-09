// What a confirmed group needs for its meetup at the airport, and how that meetup ends. Called
// from match-offer-sweep, which runs every minute under a lock - so two groups are never handed
// the same meeting point or badge in the same instant, and a group confirmed by any path (the
// passengers securing their spots, or the admin by hand) has both within a minute.
//
//   1. A meeting point (meetingPointAssignment.ts decides which), with the meeting time kept in
//      step with the ride. A group without one keeps being retried: that is what happens while
//      its terminal has no active point yet. An assignment is never changed here once made - only
//      the admin overrides it (admin_set_group_meeting_point).
//   2. A badge (badgeAssignment.ts): assigned once and never changed, not even when the meeting
//      time shifts, because members may already have seen it.
//   3. The end: MEETUP_SHARING_TIMEOUT_MINUTES after the planned departure a group that was found
//      is marked as started; so is one whose payer sent a taxi receipt (the ride evidently took
//      place). A group that never met is NOT marked started: it is flagged for the admin, and
//      while it is flagged no payment step runs for it.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { BADGE_WINDOW_MINUTES, MEETING_WINDOW_MINUTES, MEETUP_SHARING_TIMEOUT_MINUTES } from './constants.ts';
import { BadgeColor, ExistingBadge, pickBadge } from './badgeAssignment.ts';
import { rideDepartureMs } from './holdMath.ts';
import { AssignablePoint, ExistingAssignment, pickMeetingPoint } from './meetingPointAssignment.ts';
import { sendPush } from './push.ts';

const MINUTE_MS = 60_000;

// Groups whose ride was longer ago than this are left alone when closing meetups: they predate
// this, or were dealt with long ago.
const CLOSE_LOOKBACK_MS = 7 * 24 * 60 * MINUTE_MS;

type GroupRow = {
  id: string;
  meeting_point_id: string | null;
  meeting_time: string | null;
  badge_color: BadgeColor | null;
  badge_number: number | null;
  meetup_completed_at: string | null;
  meetup_flagged_at: string | null;
};
type MemberRow = { group_id: string; user_id: string | null; arrival_at: string; arrival_terminal: string | null };

type Entry = { group: GroupRow; members: MemberRow[]; terminal: string | null; meetingTimeMs: number };

export type MeetupUpkeep = {
  meetingPointsAssigned: number;
  waitingForPoint: number;
  badgesAssigned: number;
  ridesStarted: number;
  flaggedForReview: number;
};

// Confirmed groups whose ride hasn't started, soonest first. The meeting time is the ride's
// planned departure: the last landing plus the curb buffer.
async function loadConfirmedGroups(adminClient: SupabaseClient): Promise<Entry[]> {
  const { data: groupRows } = await adminClient
    .from('taxi_groups')
    .select('id, meeting_point_id, meeting_time, badge_color, badge_number, meetup_completed_at, meetup_flagged_at')
    .eq('status', 'confirmed')
    .is('ride_started_at', null);
  const groups = (groupRows ?? []) as GroupRow[];
  if (groups.length === 0) return [];

  const { data: memberRows } = await adminClient
    .from('passenger_requests')
    .select('group_id, user_id, arrival_at, arrival_terminal')
    .in(
      'group_id',
      groups.map((g) => g.id)
    );
  const membersByGroup = new Map<string, MemberRow[]>();
  for (const row of (memberRows ?? []) as MemberRow[]) {
    membersByGroup.set(row.group_id, [...(membersByGroup.get(row.group_id) ?? []), row]);
  }

  return groups
    .flatMap((group) => {
      const members = membersByGroup.get(group.id) ?? [];
      if (members.length === 0) return [];
      return [
        {
          group,
          members,
          terminal: members[0].arrival_terminal,
          meetingTimeMs: rideDepartureMs(members.map((m) => m.arrival_at)),
        },
      ];
    })
    .sort((a, b) => a.meetingTimeMs - b.meetingTimeMs);
}

async function assignMeetingPoints(adminClient: SupabaseClient, upcoming: Entry[], run: MeetupUpkeep): Promise<void> {
  const taken: ExistingAssignment[] = [];
  for (const { group, meetingTimeMs } of upcoming) {
    if (!group.meeting_point_id) continue;
    taken.push({ meetingPointId: group.meeting_point_id, meetingTimeMs });
    // Same point, but the ride moved (a member left a confirmed group).
    if (!group.meeting_time || new Date(group.meeting_time).getTime() !== meetingTimeMs) {
      await adminClient.from('taxi_groups').update({ meeting_time: new Date(meetingTimeMs).toISOString() }).eq('id', group.id);
    }
  }

  const unassigned = upcoming.filter((entry) => !entry.group.meeting_point_id);
  if (unassigned.length === 0) return;

  const { data: pointRows } = await adminClient
    .from('meeting_points')
    .select('id, terminal, short_code, sort_priority, is_active')
    .eq('is_active', true);
  const points: AssignablePoint[] = (pointRows ?? []).map((p) => ({
    id: p.id,
    terminal: p.terminal,
    shortCode: p.short_code,
    sortPriority: p.sort_priority,
    isActive: p.is_active,
  }));

  for (const { group, members, terminal, meetingTimeMs } of unassigned) {
    const choice = terminal ? pickMeetingPoint(points, terminal, meetingTimeMs, taken, MEETING_WINDOW_MINUTES) : null;
    if (!choice) {
      run.waitingForPoint += 1;
      continue;
    }

    const { data: updated } = await adminClient
      .from('taxi_groups')
      .update({ meeting_point_id: choice.point.id, meeting_time: new Date(meetingTimeMs).toISOString() })
      .eq('id', group.id)
      .eq('status', 'confirmed')
      .is('meeting_point_id', null)
      .select('id');
    // The admin picked one by hand in the meantime.
    if (!updated?.length) continue;

    group.meeting_point_id = choice.point.id;
    taken.push({ meetingPointId: choice.point.id, meetingTimeMs });
    run.meetingPointsAssigned += 1;

    // A first assignment needs no announcement (the card simply appears in the app). But a group
    // that had a point before - the admin handed the choice back - and now gets another one is
    // being sent somewhere else: tell its passengers.
    const { data: earlier } = await adminClient
      .from('group_events')
      .select('details')
      .eq('group_id', group.id)
      .eq('event_type', 'meeting_point_assigned')
      .order('created_at', { ascending: false })
      .limit(10);
    const previousPointId = (earlier ?? [])
      .map((event) => (event.details as { meeting_point_id?: string | null } | null)?.meeting_point_id)
      .find((id) => id != null);
    if (previousPointId && previousPointId !== choice.point.id) {
      for (const member of members) {
        if (member.user_id) await sendPush(adminClient, { userId: member.user_id, key: 'meetingPointChanged' });
      }
    }

    await adminClient.from('group_events').insert({
      group_id: group.id,
      event_type: 'meeting_point_assigned',
      details: {
        meeting_point_id: choice.point.id,
        short_code: choice.point.shortCode,
        source: 'auto',
        // More than 0 only when every point at the terminal was taken around that time.
        overlapping_groups: choice.overlapping,
      },
      actor_type: 'system',
    });
  }
}

// Runs after the meeting points, so groups sent to the same point can be told to differ in colour.
async function assignBadges(adminClient: SupabaseClient, upcoming: Entry[], run: MeetupUpkeep): Promise<void> {
  const badgesByTerminal = new Map<string, ExistingBadge[]>();
  for (const { group, terminal, meetingTimeMs } of upcoming) {
    if (!terminal || !group.badge_color || group.badge_number == null) continue;
    badgesByTerminal.set(terminal, [
      ...(badgesByTerminal.get(terminal) ?? []),
      { color: group.badge_color, number: group.badge_number, meetingPointId: group.meeting_point_id, meetingTimeMs },
    ]);
  }

  for (const { group, terminal, meetingTimeMs } of upcoming) {
    if (group.badge_color || !terminal) continue;
    const others = badgesByTerminal.get(terminal) ?? [];
    const badge = pickBadge(others, group.meeting_point_id, meetingTimeMs, BADGE_WINDOW_MINUTES);
    if (!badge) continue;

    // Only if it still has none: a badge, once given, is never replaced.
    const { data: updated } = await adminClient
      .from('taxi_groups')
      .update({ badge_color: badge.color, badge_number: badge.number })
      .eq('id', group.id)
      .is('badge_color', null)
      .select('id');
    if (!updated?.length) continue;

    badgesByTerminal.set(terminal, [...others, { ...badge, meetingPointId: group.meeting_point_id, meetingTimeMs }]);
    run.badgesAssigned += 1;

    await adminClient.from('group_events').insert({
      group_id: group.id,
      event_type: 'badge_assigned',
      details: { color: badge.color, number: badge.number },
      actor_type: 'system',
    });
  }
}

async function closeMeetups(adminClient: SupabaseClient, entries: Entry[], now: Date, run: MeetupUpkeep): Promise<void> {
  const nowMs = now.getTime();
  const overdue = entries.filter(({ meetingTimeMs }) => {
    const closesAtMs = meetingTimeMs + MEETUP_SHARING_TIMEOUT_MINUTES * MINUTE_MS;
    return nowMs >= closesAtMs && nowMs - closesAtMs <= CLOSE_LOOKBACK_MS;
  });
  if (overdue.length === 0) return;

  const { data: receipts } = await adminClient
    .from('ride_receipts')
    .select('group_id')
    .in(
      'group_id',
      overdue.map((entry) => entry.group.id)
    );
  const hasReceipt = new Set((receipts ?? []).map((r) => r.group_id as string));

  for (const { group } of overdue) {
    const source = group.meetup_completed_at ? 'auto' : hasReceipt.has(group.id) ? 'receipt' : null;

    if (source) {
      const { data: started } = await adminClient
        .from('taxi_groups')
        .update({ ride_started_at: now.toISOString(), ride_started_source: source, meetup_flagged_at: null })
        .eq('id', group.id)
        .is('ride_started_at', null)
        .select('id');
      if (!started?.length) continue;
      run.ridesStarted += 1;
      await adminClient.from('group_events').insert({
        group_id: group.id,
        event_type: 'ride_started',
        details: { source },
        actor_type: 'system',
      });
      continue;
    }

    // Never met, no receipt: not started. The admin reviews it, and until then nothing is charged.
    if (group.meetup_flagged_at) continue;
    const { data: flagged } = await adminClient
      .from('taxi_groups')
      .update({ meetup_flagged_at: now.toISOString() })
      .eq('id', group.id)
      .is('ride_started_at', null)
      .is('meetup_flagged_at', null)
      .select('id');
    if (!flagged?.length) continue;
    run.flaggedForReview += 1;
    await adminClient.from('group_events').insert({
      group_id: group.id,
      event_type: 'meetup_flagged',
      details: { reason: 'group_not_found' },
      actor_type: 'system',
    });
  }
}

export async function runMeetupUpkeep(adminClient: SupabaseClient, now = new Date()): Promise<MeetupUpkeep> {
  const run: MeetupUpkeep = {
    meetingPointsAssigned: 0,
    waitingForPoint: 0,
    badgesAssigned: 0,
    ridesStarted: 0,
    flaggedForReview: 0,
  };

  const entries = await loadConfirmedGroups(adminClient);
  if (entries.length === 0) return run;

  // Groups whose meetup is still ahead or going on: these get a point and a badge.
  const cutoffMs = now.getTime() - MEETUP_SHARING_TIMEOUT_MINUTES * MINUTE_MS;
  const upcoming = entries.filter((entry) => entry.meetingTimeMs >= cutoffMs);

  await assignMeetingPoints(adminClient, upcoming, run);
  await assignBadges(adminClient, upcoming, run);
  await closeMeetups(adminClient, entries, now, run);

  return run;
}
