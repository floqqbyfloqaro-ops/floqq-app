// Same underlying key as EXPO_PUBLIC_GOOGLE_ROUTES_API_KEY; the Google Cloud key must have
// Geocoding API allowed alongside Routes API in its API restrictions.
const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_ROUTES_API_KEY;

export type GeocodeResult = {
  lat: number;
  lng: number;
};

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!GOOGLE_MAPS_API_KEY || !address.trim()) {
    return null;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  const location = data?.results?.[0]?.geometry?.location;
  if (data.status !== 'OK' || !location) {
    return null;
  }

  return { lat: location.lat, lng: location.lng };
}
