import i18n from '../i18n';
import { base64ToArrayBuffer } from '../utils/base64';
import { LocalizedText, MeetingPoint, MeetingPointSummary, ShippedText } from './meetingPointRules';
import { supabase } from './supabase';

const PHOTO_BUCKET = 'meeting-point-photos';

const COLUMNS =
  'id, airport_code, terminal, short_code, name_key, directions_key, name_i18n, directions_i18n, latitude, longitude, photo_path, is_active, sort_priority, verified_at, verified_by';

// The wording shipped with the app, for the rules in meetingPointRules.ts.
// Read straight from that language's own file: a text missing in French must not be reported as
// present because English has it.
export const shippedText: ShippedText = (key, language) => {
  const value: unknown = i18n.getResource(language, 'translation', key);
  return typeof value === 'string' ? value : null;
};

// Every point, preferred ones first within their terminal. Admin screens only: passengers are
// handed their group's point by the server.
export function fetchMeetingPoints() {
  return supabase
    .from('meeting_points')
    .select(COLUMNS)
    .order('terminal', { ascending: true })
    .order('sort_priority', { ascending: false })
    .order('short_code', { ascending: true })
    .returns<MeetingPoint[]>();
}

// One point as a passenger may see it - for the "Meet at" line of their ride. (Row level security
// lets any signed-in user read the points; they hold no personal data.)
export function fetchMeetingPointSummary(id: string) {
  return supabase
    .from('meeting_points')
    .select('id, terminal, short_code, name_key, directions_key, name_i18n, directions_i18n, latitude, longitude, photo_path')
    .eq('id', id)
    .maybeSingle<MeetingPointSummary>();
}

export type MeetingPointPatch = Partial<
  Pick<
    MeetingPoint,
    'latitude' | 'longitude' | 'photo_path' | 'is_active' | 'sort_priority' | 'verified_at' | 'verified_by'
  >
> & {
  name_i18n?: LocalizedText | null;
  directions_i18n?: LocalizedText | null;
};

// Admin only (row level security). Returns the point as stored afterwards.
export function updateMeetingPoint(id: string, patch: MeetingPointPatch) {
  return supabase.from('meeting_points').update(patch).eq('id', id).select(COLUMNS).single<MeetingPoint>();
}

// What changing a point's location or photo also does: the verification was of the old one, and
// an unverified point can't stay active.
export const RESET_VERIFICATION: MeetingPointPatch = { verified_at: null, verified_by: null, is_active: false };

export async function verifiedByMe(): Promise<MeetingPointPatch> {
  const { data } = await supabase.auth.getUser();
  return { verified_at: new Date().toISOString(), verified_by: data.user?.id ?? null };
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// Uploads a photo (base64, straight from the camera or the library) into the point's folder of
// the public bucket. Returns its path.
export async function uploadMeetingPointPhoto(shortCode: string, base64: string, mimeType: string | null) {
  const contentType = mimeType && EXTENSION_BY_TYPE[mimeType] ? mimeType : 'image/jpeg';
  const path = `${shortCode}/${Date.now()}.${EXTENSION_BY_TYPE[contentType]}`;
  try {
    const body = base64ToArrayBuffer(base64);
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, { contentType });
    if (error) return { path: null as string | null, error: error.message };
    return { path, error: null as string | null };
  } catch (err) {
    return { path: null as string | null, error: err instanceof Error ? err.message : 'upload_failed' };
  }
}

// Best effort: a leftover old photo costs nothing but storage.
export async function removeMeetingPointPhoto(path: string) {
  const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([path]);
  if (error) console.warn('removeMeetingPointPhoto failed', error.message);
}

export function meetingPointPhotoUrl(path: string): string {
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
