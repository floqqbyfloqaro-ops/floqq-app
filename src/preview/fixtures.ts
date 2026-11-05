import type { LocationAccess } from '../services/locationSharing';
import type { Fix } from '../services/locationSharingRules';
import type { AirlineTerminalRow } from '../services/airlineTerminalRules';
import type { Meetup, MeetupMember } from '../services/findGroup';
import type { HelpConversation, HelpMessage, HelpRequest } from '../services/helpChat';
import type { MatchOffer, MatchOfferMember } from '../services/matchOffer';
import type { MeetingPointSummary } from '../services/meetingPointRules';
import type { MyActiveRequest, MyPassengerRequest, MyTaxiGroup } from '../services/passengerRequests';
import type { SavedCard } from '../services/payments';
import type { PlaceDetails } from '../services/placesAutocomplete';
import type { RideSummary } from '../services/rideCompletion';
import type { MyTicket } from '../services/supportInbox';

// THE sample data of the screen preview, in one place. Typed with the screens' own data types, so
// a change there that the preview doesn't follow fails the TypeScript check. Nothing here is a
// real person, ride or payment.

export const PREVIEW_USER_ID = 'preview-user';
export const PREVIEW_USER = {
  id: PREVIEW_USER_ID,
  email: 'alex@example.com',
  new_email: null,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { first_name: 'Alex', last_name: 'Martin', full_name: 'Alex Martin' },
};

const REQUEST_ID = 'preview-request';
export const PREVIEW_GROUP_ID = 'preview-group';
const FLIGHT = 'VY1803';
const DESTINATION = 'Passeig de Gràcia 43, 08007 Barcelona';

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

export type PreviewProfileRow = {
  user_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  under_age_at: string | null;
  avatar_id: number;
};

export type PreviewData = {
  // The moment the sample times are counted from.
  now: number;
  request: PreviewRequestRow;
  activeRequest: MyActiveRequest | null;
  group: MyTaxiGroup | null;
  matchOffer: MatchOffer | null;
  meetup: Meetup | null;
  rideSummary: RideSummary | null;
  airlineTerminals: AirlineTerminalRow[];
  flightStatus: PreviewFlightStatus;
  // What the address search finds, whatever is typed.
  place: PlaceDetails;
  matchingSchedule: { interval_minutes: number; last_run_at: string; server_now: string };
  // The phone's location and compass, as "Find your group" reads them.
  location: { access: LocationAccess; fix: Fix | null; heading: number };
  profile: PreviewProfileRow;
  savedCard: SavedCard | null;
  help: {
    conversation: HelpConversation;
    messages: HelpMessage[];
    requests: (HelpRequest & { user_id: string })[];
    tickets: (MyTicket & { user_id: string })[];
    // What an earlier request in "Your requests" shows when opened.
    archivedMessages: HelpMessage[];
  };
};

// Where the passenger's ride stands.
export type RideStage = 'searching' | 'expired' | 'offer' | 'confirmed' | 'meetup' | 'onTheWay' | 'completed';
// "Find your group" before landing, and the guidance states after it.
export type FindGroupSample = 'beforeLanding' | 'permission' | 'far' | 'arrow' | 'almostThere' | 'arrived';
// "Ride completed": the final amounts still to come, or charged.
export type PaymentSample = 'pending' | 'paid';

export type PreviewOptions = { findGroup?: FindGroupSample; payment?: PaymentSample };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
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

// The group's meeting point: the T1 arrivals hall, with the wording the app ships with.
const MEETING_POINT: MeetingPointSummary = {
  id: 'preview-point',
  terminal: 'T1',
  short_code: 'T1-1',
  kind: 'regular',
  name_key: 'meetingPoints.T1-FALLBACK.name',
  directions_key: 'meetingPoints.T1-FALLBACK.directions',
  name_i18n: null,
  directions_i18n: null,
  latitude: 41.28925,
  longitude: 2.07325,
  photo_path: null,
};

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
// (share + fee + a buffer of 25% of the share, at least €5). After the ride: the receipt said
// €43.80, and the passenger's final share was €14.00.
const TOTAL_FARE_CENTS = 4560;
const MY_SHARE_CENTS = 1460;
const FEE_CENTS = 249;
const HOLD_CENTS = MY_SHARE_CENTS + FEE_CENTS + Math.max(500, Math.round(MY_SHARE_CENTS * 0.25));
const RECEIPT_CENTS = 4380;
const FINAL_SHARE_CENTS = 1400;

// Landing times: Sofia 10 minutes before the passenger, Lucas (delayed by 15) 5 minutes after.
const landings = (myLanding: number) => ({ sofia: myLanding - 10 * MINUTE, me: myLanding, lucas: myLanding + 5 * MINUTE });

function offerMembers(myLanding: number, secured: boolean): MatchOfferMember[] {
  const at = landings(myLanding);
  const member = (fields: Omit<MatchOfferMember, 'readyAt' | 'secured' | 'arrivalFromFlight'>): MatchOfferMember => ({
    ...fields,
    readyAt: iso(new Date(fields.arrivalAt).getTime() + 25 * MINUTE),
    arrivalFromFlight: true,
    secured,
  });
  return [
    member({ isMe: false, order: 1, firstName: 'Sofia', avatarId: 3, destination: 'Sant Antoni', ...STOPS.sofia, arrivalAt: iso(at.sofia), scheduledArrivalAt: iso(at.sofia) }),
    member({ isMe: true, order: 2, firstName: 'Alex', avatarId: 5, destination: DESTINATION, ...STOPS.me, arrivalAt: iso(at.me), scheduledArrivalAt: iso(at.me) }),
    // 15 minutes late: shows the "delayed" line.
    member({ isMe: false, order: 3, firstName: 'Lucas', avatarId: 2, destination: 'Gràcia', ...STOPS.lucas, arrivalAt: iso(at.lucas), scheduledArrivalAt: iso(at.lucas - 15 * MINUTE) }),
  ];
}

function matchOffer(now: number, myLanding: number, confirmed: boolean): MatchOffer {
  return {
    groupId: PREVIEW_GROUP_ID,
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
    members: offerMembers(myLanding, confirmed),
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

function meetup(now: number, myLanding: number, sample: FindGroupSample, rideStartedAt: string | null): Meetup {
  const at = landings(myLanding);
  const arrived = sample === 'arrived';
  const member = (fields: Omit<MeetupMember, 'foundAt'>): MeetupMember => ({ ...fields, foundAt: null });
  return {
    groupId: PREVIEW_GROUP_ID,
    terminal: 'T1',
    meetingPoint: MEETING_POINT,
    meetingPointProvisional: false,
    meetingTime: iso(at.lucas + 25 * MINUTE),
    badge: { color: 'teal', number: 7 },
    meetupCompletedAt: null,
    continueWithoutFrom: null,
    rideStartedAt,
    windowOpensAt: iso(at.sofia),
    departureAt: iso(at.lucas + 30 * MINUTE),
    sharingEndsAt: iso(at.lucas + 90 * MINUTE),
    members: [
      member({ requestId: 'preview-request-sofia', isMe: false, firstName: 'Sofia', avatarId: 3, expectedLandingAt: iso(at.sofia), arrivedAt: arrived ? iso(now - 3 * MINUTE) : null }),
      member({ requestId: REQUEST_ID, isMe: true, firstName: 'Alex', avatarId: 5, expectedLandingAt: iso(at.me), arrivedAt: arrived ? iso(now - MINUTE) : null }),
      member({ requestId: 'preview-request-lucas', isMe: false, firstName: 'Lucas', avatarId: 2, expectedLandingAt: iso(at.lucas), arrivedAt: null }),
    ],
  };
}

// The phone's position for each guidance state, measured from the meeting point (1/1000 of a
// degree of latitude is about 111 m): far away in the city, 150 m off with an arrow, 20 m off
// ("almost there"), at the point.
function location(sample: FindGroupSample): PreviewData['location'] {
  const point = { lat: MEETING_POINT.latitude!, lng: MEETING_POINT.longitude! };
  const fix = (metersSouth: number, accuracy: number): Fix => ({ lat: point.lat - metersSouth / 111_000, lng: point.lng, accuracy, at: Date.now() });
  switch (sample) {
    case 'permission':
      return { access: 'denied', fix: null, heading: 0 };
    case 'far':
      return { access: 'granted', fix: { ...STOPS.me, accuracy: 12, at: Date.now() }, heading: 200 };
    case 'arrow':
      return { access: 'granted', fix: fix(150, 6), heading: 0 };
    case 'almostThere':
      return { access: 'granted', fix: fix(20, 6), heading: 0 };
    default:
      return { access: 'granted', fix: fix(4, 6), heading: 0 };
  }
}

function rideSummary(now: number, myLanding: number, payment: PaymentSample): RideSummary {
  const paid = payment === 'paid';
  return {
    requestId: REQUEST_ID,
    groupId: PREVIEW_GROUP_ID,
    destinationAddress: DESTINATION,
    arrivalAt: iso(myLanding),
    completedAt: iso(now - 5 * MINUTE),
    completedSource: 'passenger',
    completionSeenAt: iso(now - 4 * MINUTE),
    rating: null,
    isPayer: false,
    platformFeeCents: FEE_CENTS,
    estimatedTotalCents: TOTAL_FARE_CENTS,
    estimatedShareCents: MY_SHARE_CENTS,
    receipt: paid ? { status: 'ACCEPTED', totalCents: RECEIPT_CENTS, payerShareCents: null, reimbursementCents: null } : null,
    payment: paid
      ? { status: 'CAPTURED', finalShareCents: FINAL_SHARE_CENTS, capturedCents: FINAL_SHARE_CENTS + FEE_CENTS }
      : { status: 'HOLD_PLACED', finalShareCents: null, capturedCents: null },
    serviceFeeStatus: null,
    payout: null,
  };
}

function help(now: number, myLanding: number): PreviewData['help'] {
  const conversation: HelpConversation = {
    id: 'preview-help-1',
    state: 'active',
    title: 'Where to meet my group',
    created_at: iso(now - 5 * MINUTE),
    closed_at: null,
    previous_conversation_id: null,
    helpful: null,
    request_id: REQUEST_ID,
  };
  const ride = { arrival_at: iso(myLanding), destination_address: DESTINATION };
  return {
    conversation,
    messages: [
      { id: 'preview-help-m1', role: 'user', content: 'Where do I meet my group?', created_at: iso(now - 5 * MINUTE) },
      {
        id: 'preview-help-m2',
        role: 'assistant',
        content:
          'Your group meets in the **Terminal 1 arrivals hall**, just past the exit doors from baggage claim. Sofia and Lucas meet you there. When you land, open *Find your group* for the way there and your group badge.',
        created_at: iso(now - 4 * MINUTE),
        cards: [{ type: 'ride', destination: DESTINATION, at: iso(myLanding), status: 'confirmed', meetingPoint: 'Terminal 1 arrivals hall' }],
        actions: ['open_my_ride', 'show_badge'],
        followup: 'question',
      },
    ],
    requests: [
      { ...conversation, user_id: PREVIEW_USER_ID, last_message_at: iso(now - 4 * MINUTE), ride },
      {
        id: 'preview-help-2',
        state: 'handed_over',
        title: 'Card reserved twice?',
        created_at: iso(now - 2 * DAY),
        closed_at: null,
        previous_conversation_id: null,
        helpful: null,
        request_id: null,
        user_id: PREVIEW_USER_ID,
        last_message_at: iso(now - 2 * DAY + 10 * MINUTE),
        ride: null,
      },
      {
        id: 'preview-help-3',
        state: 'resolved_by_assistant',
        title: 'Refund for ride of 24 Oct',
        created_at: iso(now - 12 * DAY),
        closed_at: iso(now - 12 * DAY + 60 * MINUTE),
        previous_conversation_id: null,
        helpful: 'up',
        request_id: null,
        user_id: PREVIEW_USER_ID,
        last_message_at: iso(now - 12 * DAY + 20 * MINUTE),
        ride: { arrival_at: iso(now - 12 * DAY), destination_address: 'Carrer de Mallorca 120, Barcelona' },
      },
    ],
    tickets: [
      {
        user_id: PREVIEW_USER_ID,
        reference: 'FLQ-2481',
        channel: 'whatsapp',
        status: 'open',
        callback_at: null,
        resolved_at: null,
        conversation_id: 'preview-help-2',
        created_at: iso(now - 2 * DAY + 10 * MINUTE),
        resolution_category: null,
      },
    ],
    archivedMessages: [
      { id: 'preview-help-a1', role: 'user', content: 'When do I get the rest of my reservation back?', created_at: iso(now - 12 * DAY) },
      {
        id: 'preview-help-a2',
        role: 'assistant',
        content: 'Your card was charged **€16.49** (your share plus the €2.49 fee). The other **€5.60** was released the same day; your bank may take a few days to show it.',
        created_at: iso(now - 12 * DAY + MINUTE),
        cards: [{ type: 'refund', amountCents: 560, status: 'released', date: iso(now - 12 * DAY) }],
      },
    ],
  };
}

// The sample data with the passenger's ride at the given stage.
export function makePreviewData(stage: RideStage, options: PreviewOptions = {}, now: number = Date.now()): PreviewData {
  const afterLanding = stage === 'meetup' || stage === 'onTheWay' || stage === 'completed';
  const findGroup = options.findGroup ?? 'arrow';
  // Before landing: in 40 minutes. At the airport: 15 minutes ago. Otherwise in 3 hours.
  const myLanding = afterLanding
    ? now + (findGroup === 'beforeLanding' ? 40 : -15) * MINUTE
    : now + 3 * 60 * MINUTE;
  const hasGroup = stage !== 'searching' && stage !== 'expired';
  const confirmed = hasGroup && stage !== 'offer';
  const rideStartedAt = stage === 'onTheWay' || stage === 'completed' ? iso(now - 20 * MINUTE) : null;

  const request: PreviewRequestRow = {
    id: REQUEST_ID,
    user_id: PREVIEW_USER_ID,
    flight_number: FLIGHT,
    status: stage === 'expired' ? 'expired' : hasGroup ? 'matched' : 'pending',
    group_id: hasGroup ? PREVIEW_GROUP_ID : null,
    service_fee_status: 'unpaid',
    destination_address: DESTINATION,
    arrival_at: iso(myLanding),
    ready_at: iso(myLanding + 25 * MINUTE),
    max_wait_minutes: 15,
    completed_at: stage === 'completed' ? iso(now - 5 * MINUTE) : null,
    completion_seen_at: stage === 'completed' ? iso(now - 4 * MINUTE) : null,
  };

  return {
    now,
    request,
    activeRequest:
      stage === 'expired' || stage === 'completed'
        ? null
        : { id: REQUEST_ID, group_id: request.group_id, group_status: hasGroup ? (confirmed ? 'confirmed' : 'unconfirmed') : null },
    group: hasGroup
      ? {
          id: PREVIEW_GROUP_ID,
          status: confirmed ? 'confirmed' : 'unconfirmed',
          total_fare: TOTAL_FARE_CENTS / 100,
          payer_request_id: 'preview-request-lucas',
          receipt_deadline_at: null,
          ride_started_at: rideStartedAt,
          receipt_received_at: null,
          meeting_point_id: confirmed ? MEETING_POINT.id : null,
        }
      : null,
    matchOffer: hasGroup ? matchOffer(now, myLanding, confirmed) : null,
    meetup: confirmed ? meetup(now, myLanding, findGroup, rideStartedAt) : null,
    rideSummary: stage === 'completed' ? rideSummary(now, myLanding, options.payment ?? 'pending') : null,
    airlineTerminals: [
      { airline_iata: 'VY', airline_icao: 'VLG', airline_name: 'Vueling', terminal: 'T1' },
      { airline_iata: 'IB', airline_icao: 'IBE', airline_name: 'Iberia', terminal: 'T1' },
      { airline_iata: 'U2', airline_icao: 'EZY', airline_name: 'easyJet', terminal: 'T2' },
      { airline_iata: 'FR', airline_icao: 'RYR', airline_name: 'Ryanair', terminal: 'T2' },
    ],
    flightStatus: {
      found: true,
      flightKnown: true,
      estimatedLandingUtc: iso(myLanding),
      scheduledLandingUtc: iso(myLanding),
      arrivalTerminal: 'T1',
      arrivalTerminalSource: 'flight',
      operatorIata: 'VY',
      originIata: 'AMS',
      originIcao: 'EHAM',
    },
    place: { formattedAddress: `${DESTINATION}, Spain`, ...STOPS.me },
    matchingSchedule: { interval_minutes: 5, last_run_at: iso(now - 2 * MINUTE), server_now: iso(now) },
    location: location(findGroup),
    profile: { user_id: PREVIEW_USER_ID, first_name: 'Alex', last_name: 'Martin', date_of_birth: '1994-06-12', under_age_at: null, avatar_id: 5 },
    savedCard: { paymentMethodId: 'pm_preview', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2029, wallet: null },
    help: help(now, myLanding),
  };
}
