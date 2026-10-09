# Branch `feat/find-your-group`: status

Last updated 2026-10-09. Everything below is built and its server side is **live on Supabase**.
**None of it has been run on a phone yet**; `npm test` passes (143 tests of the rules).

## What was built

- **Same-terminal matching.** Every ride has an arrival terminal (T1 / T2), from flight data or
  chosen by the passenger. The database refuses mixed-terminal groups; matching, late joins and
  the admin screens follow it.
- **Request form.** Flight number optional, terminal required when the flight gives none, typed
  times read as Barcelona time, terminal prefilled from location near a verified meeting point.
- **Flight refresh schedule.** Lookups at 48 / 24 / 6 / 2 h before landing, then every 10 min
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
