import { Linking } from 'react-native';

import type { MeetupMember } from '../services/findGroup';
import { confirmMatchOffer, PREVIEW_USER, PreviewData } from './fixtures';
import { ACTION_DISABLED, isPreviewMode, notifyPreviewAction, previewData } from './previewMode';

// The screen preview's stand-in for the server. supabase.ts wraps the real Supabase client with
// withPreview(): while the preview is on, every database read, function call and login answers
// from the sample data, and every write is refused (or, where the preview moves on to the next
// screen, pretended) - nothing is sent. installPreviewNetworkGuard() is the safety net under it:
// any other request to the internet, or link to another app, fails while the preview is on.

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count: null; status: number; statusText: string };

const ok = (data: unknown): Result => ({ data, error: null, count: null, status: 200, statusText: 'OK' });
const refused = (): Result => ({ data: null, error: { message: ACTION_DISABLED }, count: null, status: 403, statusText: ACTION_DISABLED });

const NOT_SAVED = 'Preview - not saved';

// The database tables the screens read, as rows.
function tableRows(table: string, data: PreviewData): Row[] {
  switch (table) {
    case 'passenger_requests':
      return [data.request];
    case 'taxi_groups':
      return data.group ? [data.group] : [];
    case 'meeting_points':
      return data.meetup?.meetingPoint ? [data.meetup.meetingPoint] : [];
    case 'airline_terminals':
      return data.airlineTerminals;
    case 'profiles':
      return [data.profile];
    case 'help_conversations':
      return data.help.requests;
    case 'support_tickets':
      return data.help.tickets;
    default:
      console.warn(`[preview] no sample rows for table ${table}`);
      return [];
  }
}

// Table writes: a new ride is pretended (the form moves on to "Finding your match"); anything else
// is refused.
function tableWrite(operation: string, table: string): Result {
  if (operation === 'insert' && table === 'passenger_requests') {
    notifyPreviewAction(NOT_SAVED);
    return ok(null);
  }
  notifyPreviewAction();
  return refused();
}

// The database functions the screens read. Undefined: not a read.
function rpcRead(name: string, data: PreviewData): unknown {
  switch (name) {
    case 'get_my_active_request':
      return data.activeRequest ? [data.activeRequest] : [];
    case 'get_matching_schedule':
      return data.matchingSchedule;
    default:
      return undefined;
  }
}

// The database functions that write. Some are pretended - the sample data changes the way the
// server would change it, so the screen shows what comes next - and the bookkeeping a screen does
// by itself is skipped without a notice. Everything else is refused.
function rpcWrite(name: string, args: Record<string, unknown>, data: PreviewData): Result {
  const now = new Date().toISOString();
  const pretend = (value: unknown = null) => {
    notifyPreviewAction(NOT_SAVED);
    return ok(value);
  };
  const updateMe = (fields: Partial<MeetupMember>) => {
    if (!data.meetup) return;
    data.meetup = { ...data.meetup, members: data.meetup.members.map((member) => (member.isMe ? { ...member, ...fields } : member)) };
  };

  switch (name) {
    case 'mark_my_completion_seen':
    case 'log_find_group_opened':
    case 'log_location_sharing':
      return ok(null);
    case 'set_my_avatar':
    case 'save_my_rating':
      return pretend();
    case 'update_my_name':
      data.profile = { ...data.profile, first_name: String(args.p_first_name), last_name: String(args.p_last_name) };
      return pretend();
    // "Find your group": at the meeting point -> the badge; "I've found my group"; "We're in the
    // taxi" -> On the way.
    case 'member_mark_arrived':
      updateMe({ arrivedAt: now });
      return pretend({ arrived: true });
    case 'member_undo_arrival':
      updateMe({ arrivedAt: null });
      return pretend({ undone: true });
    case 'member_confirm_found':
      updateMe({ foundAt: now });
      return pretend({ confirmed: true });
    case 'member_start_ride':
      if (data.meetup) data.meetup = { ...data.meetup, rideStartedAt: now };
      if (data.group) data.group = { ...data.group, ride_started_at: now };
      return pretend({ started: true });
    // "I've arrived" -> Ride completed.
    case 'mark_my_ride_arrived':
      data.request = { ...data.request, completed_at: now };
      return pretend();
    default:
      notifyPreviewAction();
      return refused();
  }
}

// The Edge Functions the screens call. Null: refused.
function invokeFunction(name: string, body: Record<string, unknown>, data: PreviewData): { data: unknown } | null {
  switch (name) {
    case 'flight-status':
      return { data: data.flightStatus };
    case 'match-offer':
      return { data: { offer: data.matchOffer } };
    case 'find-group':
      return { data: { meetup: data.meetup } };
    case 'ride-summary':
      return { data: { summary: data.rideSummary } };
    case 'payments-get-card':
      return { data: { card: data.savedCard } };
    case 'secure-spot':
      // "Secure my spot" -> Group confirmed. Nothing is reserved.
      if (data.matchOffer) data.matchOffer = confirmMatchOffer(data.matchOffer);
      if (data.group) data.group = { ...data.group, status: 'confirmed' };
      notifyPreviewAction('Preview - nothing reserved');
      return { data: { status: 'CONFIRMED' } };
    case 'decline-match':
      notifyPreviewAction(NOT_SAVED);
      return { data: {} };
    case 'change-password':
      notifyPreviewAction('Preview - password not changed');
      return { data: { ok: true } };
    case 'help-chat':
      return helpChat(body, data);
    default:
      return null;
  }
}

// The help assistant, without the AI: the sample conversation, the earlier requests and a sample
// article for a suggested question. Sending a message is refused in helpChat.ts itself.
function helpChat(body: Record<string, unknown>, data: PreviewData): { data: unknown } | null {
  switch (body.action) {
    case 'start':
      return {
        data: { conversationId: data.help.conversation.id, conversation: data.help.conversation, messages: data.help.messages, firstName: data.profile.first_name },
      };
    case 'open': {
      const conversation = data.help.requests.find((request) => request.id === body.conversationId);
      return conversation ? { data: { conversation, messages: data.help.archivedMessages } } : null;
    }
    case 'topic':
      return {
        data: {
          title: 'Sample article',
          content: 'This is where the FLOQQ help article for this question appears. In the preview it is sample text.',
        },
      };
    case 'rate':
      notifyPreviewAction(NOT_SAVED);
      return { data: {} };
    default:
      return null;
  }
}

type Query = {
  filters: ((row: Row) => boolean)[];
  write: string | null;
  mode: 'many' | 'single' | 'maybeSingle';
  limit: number | null;
  order: { column: string; ascending: boolean } | null;
};

const field = (row: Row, column: string) => row[column] ?? null;

// A PostgREST query builder that answers from `rows`, and hands a write (insert, update, upsert,
// delete) to `write`. Filters the screens use are applied; any other builder method is accepted
// and ignored.
function fakeQuery(rows: () => unknown, write: (operation: string) => Result) {
  const query: Query = { filters: [], write: null, mode: 'many', limit: null, order: null };

  const run = (): Result => {
    if (query.write) return write(query.write);
    const value = rows();
    if (value === undefined) {
      notifyPreviewAction();
      return refused();
    }
    if (!Array.isArray(value)) return ok(value);

    let result = (value as Row[]).filter((row) => query.filters.every((keep) => keep(row)));
    if (query.order) {
      const { column, ascending } = query.order;
      result = [...result].sort((a, b) => (String(field(a, column)) < String(field(b, column)) ? -1 : 1) * (ascending ? 1 : -1));
    }
    if (query.limit != null) result = result.slice(0, query.limit);
    if (query.mode === 'many') return ok(result);
    if (result.length === 0 && query.mode === 'single') {
      return { data: null, error: { message: 'No rows (preview)', code: 'PGRST116' }, count: null, status: 406, statusText: 'Not Acceptable' };
    }
    return ok(result[0] ?? null);
  };

  const methods: Record<string, (...args: any[]) => unknown> = {
    eq: (column: string, value: unknown) => query.filters.push((row) => field(row, column) === value),
    neq: (column: string, value: unknown) => query.filters.push((row) => field(row, column) !== value),
    is: (column: string, value: unknown) => query.filters.push((row) => field(row, column) === value),
    in: (column: string, values: unknown[]) => query.filters.push((row) => values.includes(field(row, column))),
    not: (column: string, operator: string, value: unknown) =>
      operator === 'is' ? query.filters.push((row) => field(row, column) !== value) : undefined,
    gt: (column: string, value: any) => query.filters.push((row) => (field(row, column) as any) > value),
    gte: (column: string, value: any) => query.filters.push((row) => (field(row, column) as any) >= value),
    lt: (column: string, value: any) => query.filters.push((row) => (field(row, column) as any) < value),
    lte: (column: string, value: any) => query.filters.push((row) => (field(row, column) as any) <= value),
    order: (column: string, options?: { ascending?: boolean }) => {
      query.order = { column, ascending: options?.ascending ?? true };
    },
    limit: (count: number) => {
      query.limit = count;
    },
    single: () => {
      query.mode = 'single';
    },
    maybeSingle: () => {
      query.mode = 'maybeSingle';
    },
    insert: () => (query.write = 'insert'),
    update: () => (query.write = 'update'),
    upsert: () => (query.write = 'upsert'),
    delete: () => (query.write = 'delete'),
  };

  const builder: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled?: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
            Promise.resolve().then(run).then(onFulfilled, onRejected);
        }
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          methods[prop]?.(...args);
          return builder;
        };
      },
    }
  );
  return builder;
}

const refusedAsync = async () => {
  notifyPreviewAction();
  return { data: {}, error: { message: ACTION_DISABLED } };
};

// Any property not listed: a function that refuses.
function withRefusals<T extends object>(object: T): T {
  return new Proxy(object, {
    get(target, prop) {
      // Not a promise (`then`), and nothing for JavaScript's own lookups.
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return prop in target ? Reflect.get(target, prop) : refusedAsync;
    },
  });
}

function createPreviewClient() {
  const channel: object = withRefusals({
    on: () => channel,
    subscribe: () => channel,
    unsubscribe: async () => 'ok',
  });

  return withRefusals({
    from: (table: string) => fakeQuery(() => tableRows(table, previewData()), (operation) => tableWrite(operation, table)),
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      const value = rpcRead(name, previewData());
      const builder = fakeQuery(() => value, () => rpcWrite(name, args, previewData())) as { insert: () => object };
      // A database function that isn't a read counts as a write.
      return value === undefined ? builder.insert() : builder;
    },
    functions: withRefusals({
      invoke: async (name: string, options?: { body?: Record<string, unknown> }) => {
        const answer = invokeFunction(name, options?.body ?? {}, previewData());
        if (answer) return { data: answer.data, error: null };
        notifyPreviewAction();
        return { data: null, error: new Error(ACTION_DISABLED) };
      },
    }),
    auth: withRefusals({
      getUser: async () => ({ data: { user: PREVIEW_USER }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      // The next screen of each: "check your email" after sign-up; nothing after a login.
      signUp: async () => {
        notifyPreviewAction('Preview - no account created');
        return { data: { user: null, session: null }, error: null };
      },
      signInWithPassword: async () => {
        notifyPreviewAction();
        return { data: { user: null, session: null }, error: null };
      },
    }),
    channel: () => channel,
    removeChannel: async () => 'ok',
    removeAllChannels: async () => [],
    storage: withRefusals({
      from: () => withRefusals({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }),
    }),
  });
}

// The app's Supabase client, answering from the sample data while the preview is on.
export function withPreview<T extends object>(real: T): T {
  const fake = createPreviewClient();
  return new Proxy(real, {
    get(target, prop) {
      const source = isPreviewMode() ? fake : target;
      const value = Reflect.get(source, prop);
      return typeof value === 'function' ? value.bind(source) : value;
    },
  });
}

// Metro (the development server on this computer or the local network, or an Expo tunnel) keeps
// working during the preview: reloading and error messages go through it.
function isDevServer(host: string) {
  return (
    host === 'localhost' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.exp.direct')
  );
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// The address search (Google Places, Geocoding) answers with the sample address.
function googleAnswer(url: string): Response | null {
  const place = previewData().place;
  if (url.includes('places.googleapis.com/v1/places:autocomplete')) {
    return json({ suggestions: [{ placePrediction: { placeId: 'preview-place', text: { text: place.formattedAddress } } }] });
  }
  if (url.includes('places.googleapis.com/v1/places/')) {
    return json({ formattedAddress: place.formattedAddress, location: { latitude: place.lat, longitude: place.lng } });
  }
  if (url.includes('maps.googleapis.com/maps/api/geocode')) {
    return json({ status: 'OK', results: [{ geometry: { location: { lat: place.lat, lng: place.lng } } }] });
  }
  return null;
}

let guardInstalled = false;

// While the preview is on, fetch() only reaches the development server; the address search gets
// the sample answers and everything else fails without being sent. Links to other apps (Google
// Maps, WhatsApp to the team, email, a phone call to 112) don't open either.
export function installPreviewNetworkGuard() {
  if (guardInstalled) return;
  guardInstalled = true;

  const realOpenURL = Linking.openURL.bind(Linking);
  Linking.openURL = (url: string) => {
    if (!isPreviewMode()) return realOpenURL(url);
    notifyPreviewAction();
    return Promise.resolve();
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isPreviewMode()) return realFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const host = url.match(/^[a-z]+:\/\/\[?([^/:?#\]]+)/i)?.[1] ?? '';
    if (isDevServer(host)) return realFetch(input, init);
    const answer = googleAnswer(url);
    if (answer) return Promise.resolve(answer);
    console.warn(`[preview] blocked a request to ${host}`);
    return Promise.reject(new TypeError(`${ACTION_DISABLED} (network)`));
  };
}
