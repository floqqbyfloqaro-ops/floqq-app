// Gives every confirmed group a meeting point (meetingPointAssignment.ts decides which one) and
// keeps its meeting time in step with the ride. Called from match-offer-sweep, which runs every
// minute under a lock - so two groups are never handed the same point in the same instant, and a
// group confirmed by any path (the passengers securing their spots, or the admin by hand) has its
// point within a minute.
//
// A group without one keeps being retried: that is what happens while its terminal has no active
// point yet. An assignment is never changed here once made - only the admin overrides it
// (admin_set_group_meeting_point).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { MEETING_WINDOW_MINUTES, MEETUP_SHARING_TIMEOUT_MINUTES } from './constants.ts';
import { rideDepartureMs } from './holdMath.ts';
import { AssignablePoint, ExistingAssignment, pickMeetingPoint } from './meetingPointAssignment.ts';
import { sendPush } from './push.ts';

const MINUTE_MS = 60_000;

type GroupRow = { id: string; meeting_point_id: string | null; meeting_time: string | null };
type MemberRow = { group_id: string; user_id: string | null; arrival_at: string; arrival_terminal: string | null };

export type MeetingPointRun = { assigned: number; waitingForPoint: number };

export async function assignMeetingPoints(adminClient: SupabaseClient, now = new Date()): Promise<MeetingPointRun> {
  const run: MeetingPointRun = { assigned: 0, waitingForPoint: 0 };

  const { data: groupRows } = await adminClient
    .from('taxi_groups')
    .select('id, meeting_point_id, meeting_time')
    .eq('status', 'confirmed')
    .is('ride_started_at', null);
  const groups = (groupRows ?? []) as GroupRow[];
  if (groups.length === 0) return run;

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

  // The meeting time is the ride's planned departure: the last landing plus the curb buffer.
  // Groups whose meetup is over are left alone.
  const cutoffMs = now.getTime() - MEETUP_SHARING_TIMEOUT_MINUTES * MINUTE_MS;
  const upcoming = groups
    .flatMap((group) => {
      const members = membersByGroup.get(group.id) ?? [];
      if (members.length === 0) return [];
      const meetingTimeMs = rideDepartureMs(members.map((m) => m.arrival_at));
      return meetingTimeMs >= cutoffMs ? [{ group, terminal: members[0].arrival_terminal, meetingTimeMs }] : [];
    })
    .sort((a, b) => a.meetingTimeMs - b.meetingTimeMs);
  if (upcoming.length === 0) return run;

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
  if (unassigned.length === 0) return run;

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

  for (const { group, terminal, meetingTimeMs } of unassigned) {
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

    taken.push({ meetingPointId: choice.point.id, meetingTimeMs });
    run.assigned += 1;

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
      for (const member of membersByGroup.get(group.id) ?? []) {
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

  return run;
}
