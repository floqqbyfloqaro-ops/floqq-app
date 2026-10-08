// "Match found" screen: everything a passenger may see about the group proposed to them (an
// unconfirmed taxi group - see 20261008000000_match_offer.sql). A passenger can only read their
// own ride (RLS), so this function reads the group for them and hands back a privacy-safe view:
//   - the other passengers' first name, neighbourhood and landing time - never their address;
//   - their drop-offs on the map only to about 100 m (3 decimals), and a route line drawn through
//     those rounded points, so the line's end doesn't give a front door away either;
//   - the caller's own address and exact drop-off.
// The route line and the neighbourhood names come from Google and are stored the first time they
// are needed (taxi_groups.route_polyline, passenger_requests.destination_neighborhood).
//
// Deployed with the default JWT verification (any logged-in app user may call this); the ride
// must belong to the caller.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { AIRPORT } from '../_shared/constants.ts';
import { computeRoutePolyline, lookupNeighborhood } from '../_shared/googleRoutes.ts';
import { estimatedSharesCents, holdAmountCents, holdWindow, PLATFORM_FEE_CENTS, rideDepartureMs } from '../_shared/holdMath.ts';
import { paymentsEnabled } from '../_shared/stripe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type MemberRow = {
  id: string;
  user_id: string;
  passenger_name: string | null;
  destination_address: string;
  destination_lat: number | null;
  destination_lng: number | null;
  destination_neighborhood: string | null;
  arrival_at: string;
  arrival_time_source: string | null;
  scheduled_arrival_at: string | null;
  distance_km: number | null;
  spot_secured_at: string | null;
  spot_secured_group_id: string | null;
};

const MEMBER_COLUMNS =
  'id, user_id, passenger_name, destination_address, destination_lat, destination_lng, destination_neighborhood, arrival_at, arrival_time_source, scheduled_arrival_at, distance_km, spot_secured_at, spot_secured_group_id';

// About 100 m: enough for a dot on a city-wide map, not enough to find a front door.
const roundCoordinate = (value: number) => Math.round(value * 1000) / 1000;

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
    .select('id, user_id, group_id')
    .eq('id', requestId)
    .maybeSingle();
  if (!mine || mine.user_id !== user.id) {
    return jsonResponse({ error: 'Not found.' }, 404);
  }
  if (!mine.group_id) {
    return jsonResponse({ offer: null, reason: 'no_group' });
  }

  const { data: group } = await adminClient
    .from('taxi_groups')
    .select('id, status, total_fare, offer_expires_at, route_polyline, route_polyline_key')
    .eq('id', mine.group_id)
    .maybeSingle();
  if (!group || group.status === 'dissolved') {
    return jsonResponse({ offer: null, reason: 'no_group' });
  }

  const { data: memberRows } = await adminClient.from('passenger_requests').select(MEMBER_COLUMNS).eq('group_id', group.id);
  // Route order: the drop-off closest along the route first (distance_km is cumulative).
  const members = ((memberRows ?? []) as MemberRow[]).sort(
    (a, b) => (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY)
  );
  if (!members.some((m) => m.id === requestId)) {
    return jsonResponse({ offer: null, reason: 'no_group' });
  }

  // Neighbourhoods the others will see, looked up once per destination.
  await Promise.all(
    members.map(async (member) => {
      if (member.destination_neighborhood || member.destination_lat == null || member.destination_lng == null) return;
      const neighborhood = await lookupNeighborhood({ lat: member.destination_lat, lng: member.destination_lng });
      if (!neighborhood) return;
      member.destination_neighborhood = neighborhood;
      await adminClient.from('passenger_requests').update({ destination_neighborhood: neighborhood }).eq('id', member.id);
    })
  );

  // The route line, redrawn only when the stops changed.
  const stops = members
    .filter((m) => m.destination_lat != null && m.destination_lng != null)
    .map((m) => ({ lat: roundCoordinate(m.destination_lat!), lng: roundCoordinate(m.destination_lng!) }));
  let polyline: string | null = null;
  if (stops.length === members.length && stops.length > 0) {
    const key = stops.map((s) => `${s.lat},${s.lng}`).join(';');
    if (group.route_polyline && group.route_polyline_key === key) {
      polyline = group.route_polyline;
    } else {
      polyline = await computeRoutePolyline([{ lat: AIRPORT.lat, lng: AIRPORT.lng }, ...stops]);
      if (polyline) {
        await adminClient.from('taxi_groups').update({ route_polyline: polyline, route_polyline_key: key }).eq('id', group.id);
      }
    }
  }

  const hasFare = group.total_fare != null && members.every((m) => m.distance_km != null);
  const shares = hasFare
    ? estimatedSharesCents(
        members.map((m) => ({ id: m.id, distanceKm: Number(m.distance_km) })),
        Number(group.total_fare)
      )
    : null;
  const myShareCents = shares?.get(requestId) ?? null;

  // "Secure my spot": whether it reserves money on the card, and from when that's possible.
  const withPayments = paymentsEnabled();
  const { opensAt: holdOpensAt } = holdWindow(rideDepartureMs(members.map((m) => m.arrival_at)), Date.now());
  const { data: myPayment } = withPayments
    ? await adminClient
        .from('ride_payments')
        .select('payment_status')
        .eq('request_id', requestId)
        .eq('group_id', group.id)
        .maybeSingle()
    : { data: null };

  return jsonResponse({
    offer: {
      groupId: group.id,
      groupStatus: group.status,
      offerExpiresAt: group.offer_expires_at,
      totalFareCents: hasFare ? Math.round(Number(group.total_fare) * 100) : null,
      myShareCents,
      feeCents: PLATFORM_FEE_CENTS,
      holdCents: myShareCents != null ? holdAmountCents(myShareCents) : null,
      paymentsEnabled: withPayments,
      holdOpensAt: holdOpensAt.toISOString(),
      myHoldStatus: myPayment?.payment_status ?? null,
      airport: { lat: AIRPORT.lat, lng: AIRPORT.lng, name: AIRPORT.name },
      polyline,
      members: members.map((member, index) => {
        const isMe = member.id === requestId;
        const hasPoint = member.destination_lat != null && member.destination_lng != null;
        return {
          isMe,
          order: index + 1,
          firstName: firstName(member.passenger_name),
          destination: isMe ? member.destination_address : member.destination_neighborhood,
          lat: !hasPoint ? null : isMe ? member.destination_lat : roundCoordinate(member.destination_lat!),
          lng: !hasPoint ? null : isMe ? member.destination_lng : roundCoordinate(member.destination_lng!),
          arrivalAt: member.arrival_at,
          arrivalFromFlight: member.arrival_time_source === 'flight',
          scheduledArrivalAt: member.scheduled_arrival_at,
          secured: member.spot_secured_at != null && member.spot_secured_group_id === group.id,
        };
      }),
    },
  });
});
