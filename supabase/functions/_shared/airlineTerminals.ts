// The airline_terminals table for the functions that look flights up - the rule itself is
// _shared/airlineTerminalRule.ts.

import type { AirlineTerminalRow } from './airlineTerminalRule.ts';
import { AIRPORT } from './constants.ts';
import type { ArrivalTerminal } from './terminalRule.ts';

// deno-lint-ignore no-explicit-any
type AdminClient = any;

// Empty when the table can't be read: the terminal then comes from flight data or the passenger.
export async function loadAirlineTerminals(adminClient: AdminClient): Promise<AirlineTerminalRow[]> {
  const { data, error } = await adminClient
    .from('airline_terminals')
    .select('airline_iata, airline_icao, terminal')
    .eq('airport_code', AIRPORT.code);
  if (error) console.warn('loading the airline terminals failed', error.message);
  return (data ?? []) as AirlineTerminalRow[];
}

// Flight data named another terminal than the table has for this airline: kept once per flight
// and day, for the admin's "Check airline terminal" warning.
export async function recordTerminalMismatch(
  adminClient: AdminClient,
  mismatch: {
    airlineIata: string;
    flightNumber: string;
    flightDate: string;
    tableTerminal: ArrivalTerminal;
    reportedTerminal: ArrivalTerminal;
  }
): Promise<void> {
  const { error } = await adminClient.from('airline_terminal_mismatches').upsert(
    {
      airport_code: AIRPORT.code,
      airline_iata: mismatch.airlineIata,
      flight_number: mismatch.flightNumber.toUpperCase().replace(/\s/g, ''),
      flight_date: mismatch.flightDate,
      table_terminal: mismatch.tableTerminal,
      reported_terminal: mismatch.reportedTerminal,
    },
    { onConflict: 'airline_iata,flight_number,flight_date', ignoreDuplicates: true }
  );
  if (error) console.warn('recording a terminal mismatch failed', error.message);
}
