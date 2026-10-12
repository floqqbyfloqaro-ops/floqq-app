// The arrival terminal from the airline, on the app's side (the server's copy, with the tests, is
// supabase/functions/_shared/airlineTerminalRule.ts - keep the two in sync): at Barcelona an
// airline lands at one terminal, so a flight number alone says where its passenger arrives.

import type { ArrivalTerminal } from './terminalRules';

export type AirlineTerminalRow = {
  // The airline's two-character code ("VY", "U2").
  airline_iata: string;
  // Its three-letter code ("VLG", "EZY"), which some airlines print on tickets instead.
  airline_icao: string | null;
  airline_name: string;
  terminal: ArrivalTerminal;
};

// The airline part of a flight number as a passenger types it: "VY1234", "vy 1234", "U2 8055",
// "EZY8055". Null when it doesn't read as a flight number.
export function airlineCodeOf(flightNumber: string): string | null {
  const value = flightNumber.toUpperCase().replace(/[\s-]/g, '');
  const threeLetter = value.match(/^([A-Z]{3})\d{1,4}[A-Z]?$/);
  if (threeLetter) return threeLetter[1];
  // Two characters, at least one of them a letter ("U2", "3O").
  const twoCharacter = value.match(/^([A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/);
  return twoCharacter ? twoCharacter[1] : null;
}

// The table's row for the first of these airline codes it knows. Pass the operating airline first
// and the airline of the typed flight number second: on a codeshare (an Iberia number on a
// Vueling plane) it is the operating airline's terminal that counts.
export function airlineTerminal<Row extends Pick<AirlineTerminalRow, 'airline_iata' | 'airline_icao'>>(
  rows: Row[],
  codes: (string | null | undefined)[]
): Row | null {
  for (const code of codes) {
    const wanted = code?.trim().toUpperCase();
    if (!wanted) continue;
    const row = rows.find((r) => r.airline_iata === wanted || r.airline_icao === wanted);
    if (row) return row;
  }
  return null;
}

// One flight for which flight data named another terminal than the table.
export type TerminalMismatch = {
  airline_iata: string;
  flight_number: string;
  // The flight's day (YYYY-MM-DD): the same flight on the same day counts once.
  flight_date: string;
  reported_terminal: ArrivalTerminal;
  created_at: string;
};

export type AirlineToCheck = { airline_iata: string; reported_terminal: ArrivalTerminal; flights: number };

// "Check airline terminal: VY": the airlines for which flight data named another terminal than
// the table on at least `minFlights` different flights within the last `windowDays`. A mismatch
// stops counting once the table says what the flight data said (the admin corrected it).
export function airlinesToCheck(
  mismatches: TerminalMismatch[],
  rows: Pick<AirlineTerminalRow, 'airline_iata' | 'terminal'>[],
  nowMs: number,
  rule: { minFlights: number; windowDays: number }
): AirlineToCheck[] {
  const sinceMs = nowMs - rule.windowDays * 24 * 3_600_000;
  const flightsByAirlineTerminal = new Map<string, Set<string>>();
  for (const mismatch of mismatches) {
    if (new Date(mismatch.created_at).getTime() < sinceMs) continue;
    const row = rows.find((r) => r.airline_iata === mismatch.airline_iata);
    if (!row || row.terminal === mismatch.reported_terminal) continue;
    const key = `${mismatch.airline_iata}|${mismatch.reported_terminal}`;
    const flights = flightsByAirlineTerminal.get(key) ?? new Set<string>();
    flights.add(`${mismatch.flight_number}|${mismatch.flight_date}`);
    flightsByAirlineTerminal.set(key, flights);
  }
  return [...flightsByAirlineTerminal.entries()]
    .filter(([, flights]) => flights.size >= rule.minFlights)
    .map(([key, flights]) => {
      const [airline_iata, reported_terminal] = key.split('|');
      return { airline_iata, reported_terminal: reported_terminal as ArrivalTerminal, flights: flights.size };
    })
    .sort((a, b) => a.airline_iata.localeCompare(b.airline_iata));
}
