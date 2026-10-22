# Branch `feat/find-your-group`: status

Last updated 2026-10-09. Everything below is built and its server side is **live on Supabase**.
**None of it has been run on a phone yet**; `npm test` passes (143 tests of the rules).

## What was built

- **Same-terminal matching.** Every ride has an arrival terminal (T1 / T2), from flight data or
  chosen by the passenger. The database refuses mixed-terminal groups; matching, late joins and
  the admin screens follow it.
- **Request form.** Flight number optional, terminal required when the flight gives none, typed
  times read as Barcelona time, terminal prefilled from location near a verified meeting point.
- **Flight refresh schedule.** Lookups at 48 / 24 / 6 / 2 h before landing, then every 30 min
  from scheduled departure until landed; one lookup per flight.
- **Meeting points.** Table, nine inactive BCN candidates, admin "capture on site" tool (GPS or
  map pin, photo, wording in EN/FR/ES, verify, activate), automatic assignment per confirmed
  group with admin override, passenger card with "Open in Google Maps", change notifications.
- **Find your group screen.** Arrow and distance to the meeting point (own location, on the phone
  only), photo-and-directions fallback when GPS is poor, "almost there" zone, "I'm at the meeting
  point" with Undo, optional location sharing over a private channel.
- **Badge and meetup end.** Colour + shape + number per group, "I've found my group" (all members),
  "Continue without [name]" for a no-show, "We're in the taxi", automatic close after 45 min.
- **Admin flags.** Terminal conflict, no meeting point, group never met (blocks its payment
  steps until "The ride took place"), no-show passenger, meeting points closer than 30 m.

## Automatic arrival terminal (branch `feat/automatic-arrival-terminal`, 2026-10-12)

Built, not yet deployed or tried on a phone; `npm test` passes (167 tests).

- **Airline table.** `airline_terminals` (87 airlines from the airport operator's list), editable
  in the admin's "Airlines" tab. A typed flight number shows "Arriving at Terminal 1" at once,
  with a "Not correct?" link that opens the selector.
- **Flight data confirms.** The lookups already made also give the operating airline (codeshares)
  and, from about a day ahead, the terminal. Flight data wins; a waiting ride's terminal change is
  now recorded as an event too.
- **"Check airline terminal: VY".** Shown in the admin once flight data has contradicted the table
  on 3 different flights of an airline within 30 days.
- **Lookups are kept** per flight and day (`flight_lookups`) and reused: 30 min for a flight
  landing within 48 h, 24 h otherwise.
- **Fixed:** for a flight more than about two days ahead the form used to take another day's
  flight and move the passenger's date to it. It now leaves the date and time alone.

Still to test: a known airline, an unknown airline, a codeshare number, "Not correct?", editing a
ride, a flight more than two days ahead, the Airlines tab (change, add, remove), and the warning.

## "Find my group" entry (branch `feat/find-my-group-entry`, 2026-10-12)

Built, not yet deployed or tried on a phone; `npm test` passes (187 tests).

- **Button.** "Find my group", primary and pinned to the bottom of the confirmed-group screen
  (and on the My ride card), with the meeting point and time under it. Hidden once the ride has
  started or the group is gone.
- **Preview.** Until the passenger's own landing, "Find your group" shows the meeting point, the
  members with "Lands at 17:05" / "Landed" and the badge - and reads no location at all.
- **Landed.** From the passenger's expected landing (the flight's latest estimate, otherwise the
  ride's arrival time) the button pulses and guidance may run, as built before.
- **Notification.** "You've landed!" once per ride, at the expected landing; a tap opens "Find
  your group". Push no longer depends on the payments switch.
- **App open.** Opening the app after landing goes straight to "Find your group", once per ride.
- **Audit event** `find_group_opened` (state and source only).

Still to test on a phone: a group confirmed the day before (preview, no location prompt), then a
landing (highlight, notification, direct opening, back to the confirmed group).

## Admin role and job monitoring (branch `feat/admin-role-and-job-monitoring`, 2026-10-12)

Built, not yet deployed to live; `npm test` passes (213 tests). Run on the test project
`floqq-test` on 2026-10-12: all 45 migrations applied to an empty database, and all 18 checks of
`scripts/admin-role-test.mjs` passed (the matcher forming a real group was not exercised there:
the test project has no passengers and no Google Routes key).

- **The matcher needs no account.** Groups it forms have no `created_by`; it never reads the
  user list. Deleting an account no longer deletes the groups it created.
- **Admin is a role.** `user_roles` + `is_admin()`, checked for the current user. The email
  address is no longer in any access rule, database function, server function or the app.
  To make someone an admin: Supabase dashboard > Table Editor > `user_roles` > Insert row
  (`user_id` = their id from Authentication > Users, `role` = `admin`). Delete the row to undo.
- **Job monitoring.** `job_runs` holds each scheduled job's last successful run and last error;
  the admin dashboard shows them and warns when a job hasn't succeeded for a while.
- **Test script:** `scripts/admin-role-test.mjs` (60+ users, no admin at all, admin-only checks).
  It refuses to run against the live project and needs the test project's settings in
  `.env.test.local`.

## Matching every 5 minutes, with a countdown (branch `feat/matching-interval-5`, 2026-10-12)

- **Schedule.** The matcher runs every 5 minutes again (`MATCHING_INTERVAL_MINUTES`, in the app
  and the server; a test fails when the schedule and the constants disagree). The rejection
  memory re-asks after 4 minutes, so it is dormant at this interval; the dashboard warns about
  the matcher after 15 minutes without a successful run.
- **"Finding your match".** A line saying how often matches are checked, and "Next check in
  3:12" / "Checking now...", from the server's own schedule and clock (`get_matching_schedule`).
- **Verified on `floqq-test`:** runs recorded at 10:25:03 and 10:30:06 UTC, 5 minutes apart, and
  the countdown switched to "Checking now..." at each and restarted when the run finished. The
  look on screen needs a build.

## Ready time, phase A (branch `feat/ready-time-phase-a`, 2026-10-12)

Calculated and recorded; **nothing uses it yet** (matching, meeting time and expiry still go by
the arrival time until phase B).

- **Ready time** = gate arrival (`arrival_at`) + a buffer: Schengen 25 / 40 min without / with a
  checked bag, non-Schengen 45 / 60, no flight number 15 / 25 by the new luggage question. The
  database calculates it on every save of a ride.
- **Schengen or not** from the origin airport's four-letter code, kept on the ride from the
  flight lookups already made. Origin unknown: calculated as non-Schengen.
- **Editable in the dashboard:** `ready_time_settings` (the six buffers) and
  `schengen_origin_prefixes` (the countries).
- **Calibration:** `admin_ready_time_calibration()` gives the average of actual minus calculated
  per kind of flight; the dashboard card comes in phase C.
- **Verified on `floqq-test`:** all 19 checks of `scripts/ready-time-test.mjs`.
- **Not verified:** that FlightAware always returns the origin's four-letter code, and how often
  it has only a runway time (no FlightAware key was available for a sample).

## Ready time, phase B (branch `feat/ready-time-phase-b`, 2026-10-12)

Timing now goes by the ready time instead of the arrival time.

- **Matching and late join.** A group meets when its last member is ready; each member waits
  from their own ready time, and a group is only formed (or joined) if every member's own wait
  fits their own maximum - checked for the group as a whole, before any route lookup.
- **The ride's moment** used by seat reservations, the payer reminder, receipts, the meeting time
  and "Find your group" is that meeting time (it was the last arrival plus 10 minutes).
- **Ride expiry** is ready time + maximum wait.
- **A delay:** in an unconfirmed group the group is checked again and dissolved for a fresh match
  when it no longer fits; in a confirmed group nothing changes, the audit trail records
  `ready_time_conflict` and the admin dashboard flags it (10 minutes or more).
- **Verified:** the rule by unit tests (Boston + Madrid match only when the Madrid passenger will
  wait 35 minutes); on `floqq-test` the expiry change and that the matcher runs.
- **Not verified:** a real match end to end (the test project has no Google Routes key) and the
  moved payment deadlines (no payments on the test project).

## Ready time, phase C (branch `feat/ready-time-phase-c`, 2026-10-12)

App only - no database or server change.

- **"Match found" / "Group confirmed".** The meeting time (the latest ready time in the group)
  with "Includes time to leave the plane, passport control and luggage.", and "Ready around
  14:50" under each member's flight status.
- **Admin dashboard, History tab.** "Ready time calibration": per kind of ride, how many rides,
  the buffer used, and how far passengers' real arrival at the meeting point was from the
  calculated ready time on average.
- **Not verified:** anything on screen (needs a build); the texts and the rules are unit-tested.

## Fallback meeting points, phase A (branch `feat/fallback-meeting-points-phase-a`, 2026-10-22)

Why: no meeting point was verified yet, so confirmed groups never got one and "Find your group"
showed "Your meeting point will appear here shortly" forever, with no arrow.

- **Fallback point per terminal** (`T1-FALLBACK`, `T2-FALLBACK`): the arrivals hall, approximate
  coordinates, generic wording, active without a photo or on-site check. Only assigned when no
  other point is active at the terminal. Never switched automatically to a point verified later.
- **Admin.** Group list: "Group using fallback meeting point"; group page: a note to pick a real
  one. Points tab: "Fallback" / "TEST" labels; correcting a fallback's location keeps it active.
- **Passengers.** Until the group's own point is saved, "Find your group" shows a loading state
  for at most a minute, then the terminal's fallback.
- **TEST points.** Created from the Points tab, active without a photo or on-site check. Only
  where `environment_settings.allow_test_meeting_points` is on: switched on in floqq-test by
  hand, off everywhere else; the database refuses them otherwise.
- **Tested:** unit tests; `scripts/fallback-meeting-point-test.mjs` against floqq-test.

## Before anything can be tested

- [ ] A development build. iPhone: EAS has no iOS credentials for this project yet, so run
      `eas build --profile development --platform ios` yourself (Apple login needed).
- [ ] Android: create the Google Maps key, store it with `eas env:set` (name
      `GOOGLE_MAPS_ANDROID_API_KEY`), then `eas build --profile development --platform android`.
- [ ] Verify and activate at least one meeting point per terminal (nothing downstream shows
      without one). Checklist: `docs/meeting-points-site-visit-checklist.md`.

## Tests still to do

Full steps: `docs/find-your-group-test-checklist.md`.

- [ ] Admin capture tool: location, photo, wording, verify, activate, close-points warning.
- [ ] Request form: with and without flight number, terminal selector, edit, Barcelona time.
- [ ] Confirm FlightAware returns the arrival terminal for a real BCN flight (field unverified).
- [ ] Matching: T1 and T2 never grouped; admin blocked from mixing terminals.
- [ ] Flight refresh job: lookups only inside 48 h; terminal change removes from an unconfirmed
      group and flags a confirmed one.
- [ ] Meeting point and badge assigned within a minute of confirmation; different points and
      colours for overlapping groups; admin override and its notification.
- [ ] Passenger card: photo, wording per language, meeting time, Google Maps button.
- [ ] Location permission: never asked, allowed, denied, approximate.
- [ ] Guidance on a real phone: arrow, distance, poor-GPS fallback, "almost there", haptic.
- [ ] Arrival: button without location, Undo, automatic detection, badge opens once.
- [ ] Sharing: opt-in, background, stop, other members' status.
- [ ] A member cancelling mid-meetup.
- [ ] Badge: same on all phones, brightness, pulse.
- [ ] "I've found my group", no-show (3 members and 2 members), "We're in the taxi".
- [ ] Group that never meets: flagged after 45 min, payments blocked, admin clears it.
- [ ] Channel security script (`scripts/meetup-channel-security-test.mjs`): needs three test
      accounts in `.env.meetup-test.local`.
- [ ] Android map (after the key) and the Android build with a colleague.
- [ ] One database test file (`supabase/tests/database/group_rebalance.test.sql`) was adjusted
      but not run (needs Docker).

## Open decisions

1. **Receipts on flagged groups.** A group that never taps "found" is flagged and its payer's
   receipt is refused until the admin confirms. Keep, or let a receipt lift the flag?
2. **Fare after a no-show.** Remaining passengers may have to re-reserve a higher amount at the
   taxi rank and are removed if they miss the deadline. Keep, or change?
3. **No admin action yet** to release the reservations of a flagged group whose ride never happened.

## Not built

- "Message [name]" in the no-show flow (there is no group chat yet).
- Automated tests for the compass and the screen states (only their rules are tested).

## Next: group chat (not started)

Phase 0 (plan) is agreed: the chat opens as a layer on this screen so guidance keeps running.
`react-native-safe-area-context` is installed for it. Phase 1 (data model and security) is planned
but waiting on:

- [ ] The test Supabase project's settings in `.env.test.local` in the project folder (the file
      was not found there). No tests are run against the live database.
- [ ] Does the server asking Stripe directly count as payment confirmation, next to the webhook?
- [ ] Does a member whose reservation was released (share went up) lose chat access until they
      re-reserve?
