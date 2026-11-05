import type { AirlineTerminalRow } from '../services/airlineTerminalRules';
import type { MatchOffer, MatchOfferMember } from '../services/matchOffer';
import type { MyActiveRequest, MyPassengerRequest, MyTaxiGroup } from '../services/passengerRequests';
import type { PlaceDetails } from '../services/placesAutocomplete';

// THE sample data of the screen preview, in one place. Typed with the screens' own data types, so
// a change there that the preview doesn't follow fails the TypeScript check. Nothing here is a
// real person, ride or payment.

export const PREVIEW_USER_ID = 'preview-user';
export const PREVIEW_USER = {
  id: PREVIEW_USER_ID,
  email: 'alex@example.com',
  user_metadata: { first_name: 'Alex', last_name: 'Martin', full_name: 'Alex Martin' },
};

const REQUEST_ID = 'preview-request';
const GROUP_ID = 'preview-group';
const FLIGHT = 'VY1803';

// The passenger's ride as the database row the app reads (MyPassengerRequest plus the columns the
// app filters on).
export type PreviewRequestRow = MyPassengerRequest & { user_id: string };

// What the flight-status Edge Function answers (flightStatus.ts reads these fields).
export type PreviewFlightStatus = {
  found: boolean;
  flightKnown: boolean;
  estimatedLandingUtc: string | null;
  scheduledLandingUtc: string | null;
  arrivalTerminal: 'T1' | 'T2' | null;
  arrivalTerminalSource: 'flight' | null;
  operatorIata: string | null;
  originIata: string | null;
  originIcao: string | null;
};

export type PreviewData = {
  // The moment the sample times are counted from.
  now: number;
  // The passenger's own avatar.
  avatarId: number;
  request: PreviewRequestRow;
  activeRequest: MyActiveRequest | null;
  group: MyTaxiGroup | null;
  matchOffer: MatchOffer | null;
  airlineTerminals: AirlineTerminalRow[];
  flightStatus: PreviewFlightStatus;
  // What the address search finds, whatever is typed.
  place: PlaceDetails;
  matchingSchedule: { interval_minutes: number; last_run_at: string; server_now: string };
};

export type RideStage = 'searching' | 'expired' | 'offer' | 'confirmed';

const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

// Barcelona-El Prat T1 and three drop-offs in the city, in drop-off order.
const T1 = { lat: 41.2887, lng: 2.0736 };
const STOPS = {
  sofia: { lat: 41.3786, lng: 2.162 },
  me: { lat: 41.3925, lng: 2.165 },
  lucas: { lat: 41.4036, lng: 2.1565 },
};
const ROUTE: [number, number][] = [
  [T1.lat, T1.lng],
  [41.305, 2.095],
  [41.332, 2.118],
  [41.36, 2.14],
  [STOPS.sofia.lat, STOPS.sofia.lng],
  [STOPS.me.lat, STOPS.me.lng],
  [STOPS.lucas.lat, STOPS.lucas.lng],
];

// Google's encoded polyline format (precision 5), the format match-offer sends the route in.
function encodePolyline(points: [number, number][]): string {
  let out = '';
  let lastLat = 0;
  let lastLng = 0;
  const encodeValue = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    encodeValue(latE5 - lastLat);
    encodeValue(lngE5 - lastLng);
    lastLat = latE5;
    lastLng = lngE5;
  }
  return out;
}

// The fare: €45.60 for three, the passenger's own share, the FLOQQ fee and what securing reserves
// (share + fee + a buffer of 25% of the share, at least €5).
const TOTAL_FARE_CENTS = 4560;
const MY_SHARE_CENTS = 1460;
const FEE_CENTS = 249;
const HOLD_CENTS = MY_SHARE_CENTS + FEE_CENTS + Math.max(500, Math.round(MY_SHARE_CENTS * 0.25));

function members(now: number, confirmed: boolean): MatchOfferMember[] {
  const landing = now + 3 * 60 * MINUTE;
  const member = (fields: Omit<MatchOfferMember, 'readyAt' | 'secured'>): MatchOfferMember => ({
    ...fields,
    readyAt: iso(new Date(fields.arrivalAt).getTime() + 25 * MINUTE),
    secured: confirmed,
  });
  return [
    member({
      isMe: false,
      order: 1,
      firstName: 'Sofia',
      avatarId: 3,
      destination: 'Sant Antoni',
      ...latLng(STOPS.sofia),
      arrivalAt: iso(landing - 10 * MINUTE),
      arrivalFromFlight: true,
      scheduledArrivalAt: iso(landing - 10 * MINUTE),
    }),
    member({
      isMe: true,
      order: 2,
      firstName: 'Alex',
      avatarId: 5,
      destination: 'Passeig de Gràcia 43, 08007 Barcelona',
      ...latLng(STOPS.me),
      arrivalAt: iso(landing),
      arrivalFromFlight: true,
      scheduledArrivalAt: iso(landing),
    }),
    member({
      isMe: false,
      order: 3,
      firstName: 'Lucas',
      avatarId: 2,
      destination: 'Gràcia',
      ...latLng(STOPS.lucas),
      // 15 minutes late: shows the "delayed" line.
      arrivalAt: iso(landing + 5 * MINUTE),
      arrivalFromFlight: true,
      scheduledArrivalAt: iso(landing - 10 * MINUTE),
    }),
  ];
}

function latLng(point: { lat: number; lng: number }) {
  return { lat: point.lat, lng: point.lng };
}

function matchOffer(now: number, confirmed: boolean): MatchOffer {
  return {
    groupId: GROUP_ID,
    groupStatus: confirmed ? 'confirmed' : 'unconfirmed',
    offerExpiresAt: confirmed ? null : iso(now + 9 * MINUTE),
    totalFareCents: TOTAL_FARE_CENTS,
    myShareCents: MY_SHARE_CENTS,
    feeCents: FEE_CENTS,
    holdCents: HOLD_CENTS,
    holdOpensAt: iso(now - 60 * MINUTE),
    myHoldStatus: confirmed ? 'HOLD_PLACED' : null,
    airport: { ...T1, name: 'Barcelona-El Prat T1' },
    polyline: encodePolyline(ROUTE),
    members: members(now, confirmed),
  };
}

// A confirmed group from the passenger's side, after "Secure my spot".
export function confirmMatchOffer(offer: MatchOffer): MatchOffer {
  return {
    ...offer,
    groupStatus: 'confirmed',
    offerExpiresAt: null,
    myHoldStatus: 'HOLD_PLACED',
    members: offer.members.map((member) => ({ ...member, secured: true })),
  };
}

// The sample data with the passenger's ride at the given stage.
export function makePreviewData(stage: RideStage, now: number = Date.now()): PreviewData {
  const landing = now + 3 * 60 * MINUTE;
  const hasGroup = stage === 'offer' || stage === 'confirmed';
  const request: PreviewRequestRow = {
    id: REQUEST_ID,
    user_id: PREVIEW_USER_ID,
    flight_number: FLIGHT,
    status: stage === 'expired' ? 'expired' : hasGroup ? 'matched' : 'pending',
    group_id: hasGroup ? GROUP_ID : null,
    service_fee_status: 'unpaid',
    destination_address: 'Passeig de Gràcia 43, 08007 Barcelona',
    arrival_at: iso(landing),
    ready_at: iso(landing + 25 * MINUTE),
    max_wait_minutes: 15,
    completed_at: null,
    completion_seen_at: null,
  };

  return {
    now,
    avatarId: 5,
    request,
    activeRequest:
      stage === 'expired'
        ? null
        : { id: REQUEST_ID, group_id: request.group_id, group_status: hasGroup ? (stage === 'confirmed' ? 'confirmed' : 'unconfirmed') : null },
    group: hasGroup
      ? {
          id: GROUP_ID,
          status: stage === 'confirmed' ? 'confirmed' : 'unconfirmed',
          total_fare: TOTAL_FARE_CENTS / 100,
          payer_request_id: 'preview-request-lucas',
          receipt_deadline_at: null,
          ride_started_at: null,
          receipt_received_at: null,
          meeting_point_id: null,
        }
      : null,
    matchOffer: hasGroup ? matchOffer(now, stage === 'confirmed') : null,
    airlineTerminals: [
      { airline_iata: 'VY', airline_icao: 'VLG', airline_name: 'Vueling', terminal: 'T1' },
      { airline_iata: 'IB', airline_icao: 'IBE', airline_name: 'Iberia', terminal: 'T1' },
      { airline_iata: 'U2', airline_icao: 'EZY', airline_name: 'easyJet', terminal: 'T2' },
      { airline_iata: 'FR', airline_icao: 'RYR', airline_name: 'Ryanair', terminal: 'T2' },
    ],
    flightStatus: {
      found: true,
      flightKnown: true,
      estimatedLandingUtc: iso(landing),
      scheduledLandingUtc: iso(landing),
      arrivalTerminal: 'T1',
      arrivalTerminalSource: 'flight',
      operatorIata: 'VY',
      originIata: 'AMS',
      originIcao: 'EHAM',
    },
    place: { formattedAddress: 'Passeig de Gràcia 43, 08007 Barcelona, Spain', ...latLng(STOPS.me) },
    matchingSchedule: { interval_minutes: 5, last_run_at: iso(now - 2 * MINUTE), server_now: iso(now) },
  };
}
