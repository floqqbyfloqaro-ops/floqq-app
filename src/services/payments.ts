import { supabase } from './supabase';

// Starts a Stripe Checkout session for the fixed FLOQQ service fee for one passenger request.
// The Stripe secret key lives only in the create-service-fee-checkout Edge Function - the app
// just receives a hosted Checkout URL to open (see MyRideScreen).
export async function createServiceFeeCheckout(requestId: string) {
  const { data, error } = await supabase.functions.invoke('create-service-fee-checkout', {
    body: { requestId },
  });

  if (error) {
    return { url: null as string | null, error };
  }
  if (!data?.url) {
    return { url: null as string | null, error: new Error(data?.error ?? 'Could not start checkout.') };
  }
  return { url: data.url as string, error: null };
}
