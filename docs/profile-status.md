# Profile: name, email, date of birth (minimum age 18)

Three steps, one pull request each, test project first.

## Step A: server (branch `feat/profile-phase-a`, 2026-10-22)

`supabase/migrations/20261022000000_profiles_and_minimum_age.sql`

- **`profiles`**: first name, last name, date of birth (date only), `under_age_at` flag. Readable
  by its owner and the admin only; written only through functions.
- **Names**: `update_my_name` - 1-50 characters, letters of any alphabet, spaces, hyphens,
  apostrophes, at least one letter. Also renames the passenger's open rides. Other passengers see
  the profile's first name (`_shared/firstNames.ts`, used by `find-group` and `match-offer`).
- **Age**: 18 or older on the Barcelona day it is entered.
  - Sign-up with `date_of_birth` in the account data under 18: refused, no account created.
  - Existing account: `set_my_date_of_birth`, once. Under 18 is kept and flagged.
  - Rides created or edited by the passenger need a date of birth showing 18+ today; errors
    `date_of_birth_required` / `under_age` (`edit-passenger-request` returns them as 403).
- **Set once**: only `admin_set_date_of_birth` changes it, recorded in `profile_events`.
  Admin lists: `admin_under_age_accounts`, `admin_find_account`.
- **Email**: `cancel_my_email_change` withdraws a pending change.
- **Existing accounts**: profile created, name split into first word / rest.
- **Tested**: `src/services/profileRules.test.mjs`; `scripts/profile-age-test.mjs` against floqq-test.

**Do not deploy step A to live on its own**: live accounts have no date of birth yet, so their
rides would be refused before the app can ask for it (step C).

## Step B: Profile screen and editing (branch `feat/profile-phase-b`, on top of A, 2026-10-22)

App only, plus a web page and an email template.

- **Profile screen**: avatar, first + last name, email with its status, date of birth (read-only,
  "Contact support to correct it"), "Edit name and email", then the payment method.
- **Edit** (`EditProfileForm`): first name, last name, email; Save / Cancel; errors under the
  field; a confirmation on the profile after saving.
- **Email change**: Supabase's secure change (links to the current AND the new address; on in
  floqq-test, the Supabase default). While pending: "Pending confirmation: new@...", Resend link
  (60 s cooldown), Cancel change. Another account's email: "already used by another account".
  Google/Apple accounts: read-only, "Managed by Google/Apple".
- **Links land on** `docs/email-changed.html` (GitHub Pages - published once merged to main).
  floqq-test's redirect allow-list now holds the email-verified, email-changed and reset-password
  pages.
- **Email template**: `supabase/templates/change-email.html` (EN/FR/ES) - paste into Supabase →
  Authentication → Emails → Change email address.
- **Tested**: unit tests (provider rule); `scripts/profile-age-test.mjs` now also confirms an
  email change with both links (31 checks). Where the app's links land is checked on a phone:
  links made by the admin API ignore the requested destination.

## Step C: date of birth at sign-up and before rides; admin "Accounts" tab (not started)
