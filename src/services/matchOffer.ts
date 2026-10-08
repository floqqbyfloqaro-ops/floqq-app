import { supabase } from './supabase';

export type MatchOfferMember = {
  isMe: boolean;
  // Drop-off order along the route, starting at 1.
  order: number;
  firstName: string | null;
  // The caller's own address; for everyone else only the neighbourhood (null if unknown).
  destination: string | null;
  // Other passengers' drop-offs are rounded to about 100 m by the server.
  lat: number | null;
  lng: number | null;
  arrivalAt: string;
  arrivalFromFlight: boolean;
  scheduledArrivalAt: string | null;
  secured: boolean;
};

export type MatchOffer = {
  groupId: string;
  groupStatus: 'unconfirmed' | 'confirmed';
  // End of the response window; null while none is running.
  offerExpiresAt: string | null;
  totalFareCents: number | null;
  myShareCents: number | null;
  feeCents: number;
  // What "Secure my spot" reserves on the card (share + fee + buffer) when payments are on.
  holdCents: number | null;
  paymentsEnabled: boolean;
  // A card hold is only possible from this moment; before it, securing reserves nothing yet.
  holdOpensAt: string;
  // The caller's own reservation for this group, if they started one.
  myHoldStatus: string | null;
  airport: { lat: number; lng: number; name: string };
  // Google encoded polyline of the planned route; null until it's available.
  polyline: string | null;
  members: MatchOfferMember[];
};

// The group proposed to this ride, as the passenger may see it (match-offer Edge Function - a
// passenger can't read the other passengers' rides themselves). offer is null when the ride has
// no group (any more).
export async function fetchMatchOffer(requestId: string) {
  const { data, error } = await supabase.functions.invoke('match-offer', { body: { requestId } });
  if (error) return { offer: null as MatchOffer | null, error };
  return { offer: (data?.offer ?? null) as MatchOffer | null, error: null };
}

export type SecureSpotResponse = {
  // SECURED: done. HOLD_REQUIRED: go on to placeRideHold with ridePaymentId. CONFIRMED: the group
  // was confirmed in the meantime.
  status?: 'SECURED' | 'HOLD_REQUIRED' | 'CONFIRMED';
  ridePaymentId?: string;
  error?: string;
};

// "Secure my spot" (secure-spot Edge Function). Never charges anything by itself and is safe to
// repeat - with payments on, the reservation is then placed through placeRideHold.
export async function secureSpot(requestId: string) {
  const { data, error } = await supabase.functions.invoke('secure-spot', { body: { requestId } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context ? await context.json().catch(() => null) : null;
    return { result: (body ?? null) as SecureSpotResponse | null, error };
  }
  return { result: data as SecureSpotResponse, error: null };
}

export type MapPoint = { latitude: number; longitude: number };

// Google's encoded polyline format -> points (precision 5).
export function decodePolyline(encoded: string): MapPoint[] {
  const points: MapPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readDelta = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += readDelta();
    lng += readDelta();
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

// Calls onChange whenever the passenger's own ride or its group changes (Supabase Realtime; row
// level security limits what arrives to their own ride and group). Returns the unsubscribe.
// `scope` keeps two screens watching the same ride on separate channels.
export function subscribeToRide(scope: string, requestId: string, groupId: string | null, onChange: () => void) {
  let channel = supabase
    .channel(`ride-${scope}-${requestId}-${groupId ?? 'none'}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'passenger_requests', filter: `id=eq.${requestId}` },
      onChange
    );
  if (groupId) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'taxi_groups', filter: `id=eq.${groupId}` },
      onChange
    );
  }
  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
