import { AIRLINE_TERMINAL_CHECK, AIRPORT } from '../constants';
import type { AirlineTerminalRow, TerminalMismatch } from './airlineTerminalRules';
import { supabase } from './supabase';
import type { ArrivalTerminal } from './terminalRules';

const COLUMNS = 'airline_iata, airline_icao, airline_name, terminal';

// Which airline lands at which terminal. (Row level security lets any signed-in user read the
// table - it holds no personal data - and only the admin change it.)
export function fetchAirlineTerminals() {
  return supabase
    .from('airline_terminals')
    .select(COLUMNS)
    .eq('airport_code', AIRPORT.code)
    .order('airline_name', { ascending: true })
    .returns<AirlineTerminalRow[]>();
}

export type AirlineTerminalInput = {
  airlineIata: string;
  airlineIcao: string | null;
  airlineName: string;
  terminal: ArrivalTerminal;
};

// Admin only. Adds the airline, or changes it when its code is already in the table.
export function saveAirlineTerminal(input: AirlineTerminalInput) {
  return supabase
    .from('airline_terminals')
    .upsert({
      airport_code: AIRPORT.code,
      airline_iata: input.airlineIata,
      airline_icao: input.airlineIcao,
      airline_name: input.airlineName,
      terminal: input.terminal,
      updated_at: new Date().toISOString(),
    })
    .select(COLUMNS)
    .single<AirlineTerminalRow>();
}

// Admin only.
export function setAirlineTerminal(airlineIata: string, terminal: ArrivalTerminal) {
  return supabase
    .from('airline_terminals')
    .update({ terminal, updated_at: new Date().toISOString() })
    .eq('airport_code', AIRPORT.code)
    .eq('airline_iata', airlineIata);
}

// Admin only.
export function deleteAirlineTerminal(airlineIata: string) {
  return supabase.from('airline_terminals').delete().eq('airport_code', AIRPORT.code).eq('airline_iata', airlineIata);
}

// Admin only: the recent flights for which flight data named another terminal than the table.
export function fetchTerminalMismatches() {
  const since = new Date(Date.now() - AIRLINE_TERMINAL_CHECK.windowDays * 24 * 3_600_000).toISOString();
  return supabase
    .from('airline_terminal_mismatches')
    .select('airline_iata, flight_number, flight_date, reported_terminal, created_at')
    .eq('airport_code', AIRPORT.code)
    .gte('created_at', since)
    .returns<TerminalMismatch[]>();
}
