import { getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

// The call-back phone number: a country picked from the list plus the number as the passenger
// types it. Checked here for a quick answer, and again on the server (support-handover).

// Most FLOQQ passengers land in Barcelona from these: shown first in the picker.
const COMMON: CountryCode[] = ['ES', 'FR', 'GB', 'DE', 'IT', 'NL', 'BE', 'PT', 'CH', 'IE', 'US'];

export type PhoneCountry = { code: CountryCode; dialCode: string; flag: string };

// "ES" -> 🇪🇸 (regional indicator letters), so no country names need translating.
export function flagFor(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export function phoneCountries(): PhoneCountry[] {
  const others = getCountries()
    .filter((code) => !COMMON.includes(code))
    .sort();
  return [...COMMON, ...others].map((code) => ({ code, dialCode: `+${getCountryCallingCode(code)}`, flag: flagFor(code) }));
}

// The number in international form (+34612345678), or null when it isn't a valid number for that
// country. A number typed with its own "+..." prefix wins over the picked country.
export function toE164(country: CountryCode, typed: string): string | null {
  const cleaned = typed.trim();
  if (!cleaned) return null;
  const phone = parsePhoneNumberFromString(cleaned, cleaned.startsWith('+') ? undefined : country);
  return phone && phone.isValid() ? phone.number : null;
}
