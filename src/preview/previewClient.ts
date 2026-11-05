import { confirmMatchOffer, PREVIEW_USER, PREVIEW_USER_ID, PreviewData } from './fixtures';
import { ACTION_DISABLED, isPreviewMode, notifyPreviewAction, previewData } from './previewMode';

// The screen preview's stand-in for the server. supabase.ts wraps the real Supabase client with
// withPreview(): while the preview is on, every database read, function call and login answers
// from the sample data, and every write is refused (or, where the preview moves on to the next
// screen, pretended) - nothing is sent. installPreviewNetworkGuard() is the safety net under it:
// any other request to the internet fails while the preview is on.

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count: null; status: number; statusText: string };

const ok = (data: unknown): Result => ({ data, error: null, count: null, status: 200, statusText: 'OK' });
const refused = (): Result => ({ data: null, error: { message: ACTION_DISABLED }, count: null, status: 403, statusText: ACTION_DISABLED });

// Writes the preview pretends worked, so the screen moves on as it would (nothing is saved): a new
// ride, and the avatar picker showing the new choice.
const PRETENDED_WRITES = new Set(['insert:passenger_requests', 'insert:rpc:set_my_avatar']);
const NOT_SAVED = 'Preview - not saved';

// The database tables the screens read, as rows.
function tableRows(table: string, data: PreviewData): Row[] {
  switch (table) {
    case 'passenger_requests':
      return [data.request];
    case 'taxi_groups':
      return data.group ? [data.group] : [];
    case 'airline_terminals':
      return data.airlineTerminals;
    case 'profiles':
      return [{ user_id: PREVIEW_USER_ID, avatar_id: data.avatarId, first_name: 'Alex', last_name: 'Martin' }];
    default:
      console.warn(`[preview] no sample rows for table ${table}`);
      return [];
  }
}

// The database functions the screens read. Undefined: not a read - refused.
function rpcValue(name: string, data: PreviewData): unknown {
  switch (name) {
    case 'get_my_active_request':
      return data.activeRequest ? [data.activeRequest] : [];
    case 'get_matching_schedule':
      return data.matchingSchedule;
    default:
      return undefined;
  }
}

// The Edge Functions the screens call. Null: refused.
function invokeFunction(name: string, data: PreviewData): { data: unknown } | null {
  switch (name) {
    case 'flight-status':
      return { data: data.flightStatus };
    case 'match-offer':
      return { data: { offer: data.matchOffer } };
    case 'secure-spot':
      // "Secure my spot" -> Group confirmed. Nothing is reserved.
      if (data.matchOffer) data.matchOffer = confirmMatchOffer(data.matchOffer);
      if (data.group) data.group = { ...data.group, status: 'confirmed' };
      notifyPreviewAction('Preview - nothing reserved');
      return { data: { status: 'CONFIRMED' } };
    case 'decline-match':
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

// A PostgREST query builder that answers from `rows` (or refuses a write). Filters the screens use
// are applied; any other builder method is accepted and ignored.
function fakeQuery(kind: string, rows: () => unknown) {
  const query: Query = { filters: [], write: null, mode: 'many', limit: null, order: null };

  const run = (): Result => {
    if (query.write) {
      if (PRETENDED_WRITES.has(`${query.write}:${kind}`)) {
        notifyPreviewAction(NOT_SAVED);
        return ok(null);
      }
      notifyPreviewAction();
      return refused();
    }
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
    from: (table: string) => fakeQuery(table, () => tableRows(table, previewData())),
    rpc: (name: string) => {
      const value = rpcValue(name, previewData());
      const builder = fakeQuery(`rpc:${name}`, () => value) as { insert: () => object };
      // A database function that isn't a read counts as a write: pretended or refused.
      return value === undefined ? builder.insert() : builder;
    },
    functions: withRefusals({
      invoke: async (name: string) => {
        const answer = invokeFunction(name, previewData());
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
// the sample answers and everything else fails without being sent.
export function installPreviewNetworkGuard() {
  if (guardInstalled) return;
  guardInstalled = true;
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
