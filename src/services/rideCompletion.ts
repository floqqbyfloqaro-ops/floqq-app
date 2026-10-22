import { RatingReason, RideSummaryFacts } from './rideSummaryRules';
import { supabase } from './supabase';

// "Ride completed": the passenger's arrival, their ride's summary, their rating, and their past
// trips. The server side is supabase/migrations/20261023010000_ride_completion_and_ratings.sql and
// the ride-summary Edge Function.

export type RideSummary = RideSummaryFacts & {
  requestId: string;
  groupId: string;
  destinationAddress: string;
  arrivalAt: string;
  completedAt: string | null;
  completedSource: 'passenger' | 'receipt' | 'auto' | 'admin' | null;
  completionSeenAt: string | null;
  rating: { stars: number; reasons: RatingReason[]; comment: string | null } | null;
};

export async function fetchRideSummary(requestId: string) {
  const { data, error } = await supabase.functions.invoke('ride-summary', { body: { requestId } });
  if (error) return { summary: null as RideSummary | null, error };
  return { summary: (data?.summary ?? null) as RideSummary | null, error: null };
}

// "I've arrived": this passenger's ride is completed (theirs only - the others arrive in their
// own time).
export async function markArrived(requestId: string) {
  const { error } = await supabase.rpc('mark_my_ride_arrived', { p_request_id: requestId });
  if (error) console.warn('mark_my_ride_arrived failed', error);
  return { error };
}

// "Ride completed" was shown after an automatic completion: not again.
export async function markCompletionSeen(requestId: string) {
  const { error } = await supabase.rpc('mark_my_completion_seen', { p_request_id: requestId });
  if (error) console.warn('mark_my_completion_seen failed', error);
}

// One rating per passenger per ride; saving again changes it.
export async function saveRating(requestId: string, stars: number, reasons: RatingReason[], comment: string | null) {
  const { error } = await supabase.rpc('save_my_rating', {
    p_request_id: requestId,
    p_stars: stars,
    p_reasons: reasons,
    p_comment: comment,
  });
  if (error) console.warn('save_my_rating failed', error);
  return { error };
}

export type MyTrip = {
  id: string;
  destination_address: string;
  arrival_at: string;
  completed_at: string;
};

// The passenger's completed rides, newest first (row level security: their own only).
export function fetchMyTrips() {
  return supabase
    .from('passenger_requests')
    .select('id, destination_address, arrival_at, completed_at')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(30)
    .returns<MyTrip[]>();
}

// Whether opening the app should show "Ride completed": the passenger's latest ride was completed
// automatically and they haven't seen it yet. Any failure is a "no".
export async function hasUnseenCompletedRide(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('passenger_requests')
      .select('id')
      .not('completed_at', 'is', null)
      .is('completion_seen_at', null)
      .limit(1);
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}
