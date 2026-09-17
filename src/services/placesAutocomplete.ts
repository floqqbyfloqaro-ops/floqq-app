// Same underlying key as EXPO_PUBLIC_GOOGLE_ROUTES_API_KEY (see googleRoutes.ts/geocoding.ts) -
// the Google Cloud key must have Places API (New) allowed alongside Routes/Geocoding in its API
// restrictions, or these calls will fail with 403.
const GOOGLE_PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_ROUTES_API_KEY;

export type PlaceSuggestion = {
  placeId: string;
  text: string;
};

export type PlaceDetails = {
  formattedAddress: string;
  lat: number;
  lng: number;
};

// A session token groups one autocomplete search + its final details lookup into a single
// Google-billed session instead of billing each keystroke's request separately.
export function generateSessionToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function autocompletePlaces(input: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  if (!GOOGLE_PLACES_API_KEY || !input.trim()) {
    return [];
  }

  const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify({ input, sessionToken }),
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const suggestions: unknown[] = Array.isArray(data?.suggestions) ? data.suggestions : [];

  return suggestions
    .map((suggestion: any) => ({
      placeId: suggestion?.placePrediction?.placeId,
      text: suggestion?.placePrediction?.text?.text,
    }))
    .filter((suggestion): suggestion is PlaceSuggestion => Boolean(suggestion.placeId && suggestion.text));
}

export async function getPlaceDetails(placeId: string, sessionToken: string): Promise<PlaceDetails | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }

  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
    {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'formattedAddress,location',
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  if (!data?.formattedAddress || !data?.location) {
    return null;
  }

  return {
    formattedAddress: data.formattedAddress,
    lat: data.location.latitude,
    lng: data.location.longitude,
  };
}
