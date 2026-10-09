// "Find your group": what a passenger needs to meet their confirmed group at the airport. A
// passenger can only read their own ride (RLS), so this function reads the group for them and
// hands back who is in it (first names only), where it meets (the terminal and, once assigned, the
// meeting point) and when the meetup runs:
//   - windowOpensAt: the first member's landing time - from then on members may share their live
//     location with each other;
//   - sharingEndsAt: the safety timeout after the planned departure, when sharing switches itself
//     off regardless.
// Live positions never pass through here (or any other function): they go from phone to phone
// over the group's private Realtime channel - see 20261009010000_find_your_group_sharing.sql.
//
// Deployed with the default JWT verification (any logged-in app user may call this); the ride
// must belong to the caller.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { MEETUP_SHARING_TIMEOUT_MINUTES, NO_SHOW_WAIT_MINUTES } from '../_shared/constants.ts';
import { rideDepartureMs } from '../_shared/holdMath.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MINUTE_MS = 60_000;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let requestId = '';
  try {
    const body = await req.json();
    requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  if (!requestId) {
    return jsonResponse({ error: 'requestId is required.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData } = await adminClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const user = userData.user;
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const { data: mine } = await adminClient
    .from('passenger_requests')
    .select('id, user_id, group_id, status')
    .eq('id', requestId)
    .maybeSingle();
  if (!mine || mine.user_id !== user.id) {
    return jsonResponse({ error: 'Not found.' }, 404);
  }
  if (!mine.group_id || mine.status !== 'matched') {
    return jsonResponse({ meetup: null, reason: 'no_group' });
  }

  const { data: group } = await adminClient
    .from('taxi_groups')
    .select('id, status, ride_started_at, meeting_point_id, meeting_time, badge_color, badge_number, meetup_completed_at')
    .eq('id', mine.group_id)
    .maybeSingle();
  if (!group || group.status !== 'confirmed') {
    return jsonResponse({ meetup: null, reason: 'not_confirmed' });
  }

  const { data: memberRows } = await adminClient
    .from('passenger_requests')
    .select('id, passenger_name, arrival_at, arrival_terminal, found_group_at')
    .eq('group_id', group.id)
    .order('arrival_at', { ascending: true })
    .order('id', { ascending: true });
  const members = memberRows ?? [];
  if (!members.some((m) => m.id === requestId)) {
    return jsonResponse({ meetup: null, reason: 'no_group' });
  }

  const arrivals = members.map((m) => m.arrival_at as string);
  const firstArrivalMs = Math.min(...arrivals.map((a) => new Date(a).getTime()));
  const departureMs = rideDepartureMs(arrivals);

  // Where the group meets: assigned within a minute of confirmation (_shared/meetingPoints.ts),
  // so it can still be missing - the app then shows the terminal alone. The wording travels as the
  // app's own i18n keys plus the admin's edits; the app picks the passenger's language.
  const { data: meetingPoint } = group.meeting_point_id
    ? await adminClient
        .from('meeting_points')
        .select('id, terminal, short_code, name_key, directions_key, name_i18n, directions_i18n, latitude, longitude, photo_path')
        .eq('id', group.meeting_point_id)
        .maybeSingle()
    : { data: null };

  // "I've found my group": from the first confirmation the others have NO_SHOW_WAIT_MINUTES; after
  // that the members who are there may continue without whoever hasn't confirmed.
  const foundTimes = members.filter((m) => m.found_group_at != null).map((m) => new Date(m.found_group_at).getTime());
  const continueWithoutFrom = foundTimes.length
    ? new Date(Math.min(...foundTimes) + NO_SHOW_WAIT_MINUTES * MINUTE_MS).toISOString()
    : null;

  return jsonResponse({
    meetup: {
      groupId: group.id,
      // The group's badge: assigned within a minute of confirmation and never changed after.
      badge: group.badge_color && group.badge_number != null ? { color: group.badge_color, number: group.badge_number } : null,
      // Set once every member has confirmed "I've found my group".
      meetupCompletedAt: group.meetup_completed_at,
      continueWithoutFrom,
      // 'T1' / 'T2': a group only ever holds passengers arriving at one terminal.
      terminal: members.find((m) => m.arrival_terminal != null)?.arrival_terminal ?? null,
      meetingPoint: meetingPoint ?? null,
      meetingTime: group.meeting_time ?? new Date(departureMs).toISOString(),
      rideStartedAt: group.ride_started_at,
      windowOpensAt: new Date(firstArrivalMs).toISOString(),
      departureAt: new Date(departureMs).toISOString(),
      sharingEndsAt: new Date(departureMs + MEETUP_SHARING_TIMEOUT_MINUTES * MINUTE_MS).toISOString(),
      members: members.map((member) => ({
        // The member's ride id: what their live position is labelled with on the group's channel.
        requestId: member.id,
        isMe: member.id === requestId,
        firstName: firstName(member.passenger_name),
        // When this member confirmed "I've found my group"; null: not yet.
        foundAt: member.found_group_at,
      })),
    },
  });
});
