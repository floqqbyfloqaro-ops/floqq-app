# Ride completed: arrival, honest summary, ratings

Three steps on stacked branches (`feat/ride-completed-phase-a` → `-b` → `-c`); merge the step C
pull request only - it contains A and B.

## Step A: server
- `supabase/migrations/20261023010000_ride_completion_and_ratings.sql`: per-passenger
  `completed_at` / `completed_source` / `completion_seen_at`, the group's `completed_at`, audit
  events `passenger_arrived` / `ride_completed`; the taxi receipt completes everyone (the payer
  is the last one out); `system_complete_rides` (called by `match-offer-sweep`,
  `RIDE_AUTO_COMPLETE_HOURS` = 3); a completed ride is no longer the active ride; `ride_ratings`
  with `save_my_rating` and `admin_rating_summary`.
- `supabase/functions/ride-summary`: one passenger's own figures (default JWT verification).
- `src/services/rideSummaryRules.ts`: what reads "Paid", "Pending", "Est." - "Paid" only when
  charged; payments off shows estimates only; the payer's share is "Paid to the taxi".

## Step B: app
- "On the way": "I've arrived" with a confirmation.
- `RideCompletedScreen`: animated checkmark (`CompletedCheck`, respects Reduce motion), the
  summary (updates live), optional stars; 1-4 stars open `RatingFollowUpSheet` (reason chips,
  comment up to 500, Send/Skip, "Report a safety problem" email when "Other passengers" is
  picked).
- Completed by the receipt or automatically: shown once (app open, or My Ride).
- My Ride: "My trips", each opening its summary.

## Step C: admin
- History tab: "Ratings" - average, star distribution, most frequent reasons, latest ratings
  with a comment or 1-2 stars ("Needs review"), each opening its ride.
- Active tab: "Low ratings in the last 7 days: N" while there are any.

## Not built (decided)
- No App Store / Google Play review prompt (Google Play forbids asking only happy users).
- No separate "final amount ready" notification: "Your ride is paid" already goes out at capture.

## Tested
- Unit tests: `rideSummaryRules.test.mjs`, `onTheWayRules.test.mjs`.
- `scripts/ride-completion-test.mjs` against floqq-test (24 checks).
- Not on a phone yet (small iPhone, Android, EN/FR/ES).

## Go-live order
1. Merge the step C pull request.
2. `npx supabase db push` (the migration above).
3. Deploy `ride-summary` (default) and `match-offer-sweep` (`--no-verify-jwt`).
4. Only then release the app build: it reads the new completion columns.
