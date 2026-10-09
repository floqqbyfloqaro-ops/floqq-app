// The pure rules around meeting points - no React Native imports, so they can be unit tested with
// plain Node.

// Every language the app ships in: a meeting point needs its wording in all of them.
export const MEETING_POINT_LANGUAGES = ['en', 'fr', 'es'] as const;
export type MeetingPointLanguage = (typeof MEETING_POINT_LANGUAGES)[number];

export type LocalizedText = Partial<Record<MeetingPointLanguage, string>>;

// The language a point is read in: the app's own, if it is one the points are worded in.
export function wordingLanguageFor(appLanguage: string): MeetingPointLanguage {
  const base = appLanguage.split('-')[0];
  return (MEETING_POINT_LANGUAGES as readonly string[]).includes(base) ? (base as MeetingPointLanguage) : 'en';
}

export type MeetingPoint = {
  id: string;
  airport_code: string;
  terminal: string;
  short_code: string;
  // The wording shipped with the app (i18n keys)...
  name_key: string;
  directions_key: string;
  // ...and what the admin changed it to, per language. Where present it wins.
  name_i18n: LocalizedText | null;
  directions_i18n: LocalizedText | null;
  latitude: number | null;
  longitude: number | null;
  photo_path: string | null;
  is_active: boolean;
  sort_priority: number;
  verified_at: string | null;
  verified_by: string | null;
};

export type WordingField = 'name' | 'directions';

// The part of a point its wording comes from.
export type WordedPoint = Pick<MeetingPoint, 'name_key' | 'directions_key' | 'name_i18n' | 'directions_i18n'>;

// A point as a passenger sees it: where it is and what it is called, nothing about its status.
export type MeetingPointSummary = WordedPoint &
  Pick<MeetingPoint, 'id' | 'terminal' | 'short_code' | 'latitude' | 'longitude' | 'photo_path'>;

// Looks up the wording shipped with the app for one language; null when there is none.
export type ShippedText = (key: string, language: MeetingPointLanguage) => string | null;

// What a passenger reading `language` sees: the admin's wording if there is one, else the shipped
// wording. Empty when neither exists.
export function meetingPointText(
  point: WordedPoint,
  field: WordingField,
  language: MeetingPointLanguage,
  shipped: ShippedText
): string {
  const override = (field === 'name' ? point.name_i18n : point.directions_i18n)?.[language]?.trim();
  if (override) return override;
  return shipped(field === 'name' ? point.name_key : point.directions_key, language)?.trim() ?? '';
}

export function hasAllWording(point: WordedPoint, shipped: ShippedText): boolean {
  return MEETING_POINT_LANGUAGES.every(
    (language) =>
      meetingPointText(point, 'name', language, shipped) !== '' &&
      meetingPointText(point, 'directions', language, shipped) !== ''
  );
}

export type MissingDetail = 'coordinates' | 'photo' | 'wording' | 'verified';

// What still stands between a point and being verified on site: everything a passenger would be
// shown must be there first.
export function missingForVerification(point: MeetingPoint, shipped: ShippedText): MissingDetail[] {
  const missing: MissingDetail[] = [];
  if (point.latitude == null || point.longitude == null) missing.push('coordinates');
  if (!point.photo_path) missing.push('photo');
  if (!hasAllWording(point, shipped)) missing.push('wording');
  return missing;
}

// A point can only be active with coordinates, a photo, wording in every language, and an admin's
// on-site verification.
export function missingForActivation(point: MeetingPoint, shipped: ShippedText): MissingDetail[] {
  const missing = missingForVerification(point, shipped);
  if (!point.verified_at) missing.push('verified');
  return missing;
}
