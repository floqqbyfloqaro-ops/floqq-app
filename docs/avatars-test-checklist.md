# Avatars – checks on a phone

What `scripts/avatars-test.mjs` (server: sign-up, keeping, changing, the group's view) and
`src/avatars/avatarRules.test.mjs` (lookup, fallback) can't check: do these by hand with
`npm start` (test project), on a small iPhone (e.g. SE), a large iPhone and an Android phone.
Tick each in EN, FR and ES where it says so.

## Sign-up

- [ ] Sign up: after the details, "Continue" opens "Choose your avatar" (EN/FR/ES) with the 8 avatars in a 4 x 2 grid and one already selected (purple ring + checkmark), shown large above the grid.
- [ ] Sign up twice: the pre-selected avatar is not always the same one.
- [ ] Tap another avatar: the ring and checkmark move, a light haptic, the large preview changes.
- [ ] "Back to your details" keeps what was typed; "Create account" then creates the account with the chosen avatar (check it on Profile after logging in).
- [ ] An invalid field (e.g. password too short) stays on the details step with its message.

## Profile

- [ ] The avatar large at the top with a small pencil badge; tapping it opens the bottom sheet with the same grid, the current avatar selected.
- [ ] Tap another avatar: haptic, "Avatar updated" for about 2 seconds, and the avatar behind the sheet changes at once.
- [ ] Airplane mode, tap another avatar: it goes back to the previous one with "We couldn't save your avatar. Please try again."
- [ ] "Done" and a tap on the dimmed area close the sheet; Android back closes it.

## Shown everywhere (straight after a change on Profile, no restart)

- [ ] "Finding your match": your avatar in the middle, a neutral silhouette on each side.
- [ ] "Match found" / "Group confirmed": every passenger with their own avatar.
- [ ] "Find your group": the members list; badge screen: the members list.
- [ ] Help chat: your messages carry your avatar (once per group of messages); the assistant keeps the F glyph.
- [ ] A second phone in the same group: after the first phone changes its avatar, the second shows it on its next refresh (pull to refresh / reopen the screen).
- [ ] Admin: Accounts (flagged list and a found account), Help → support inbox and a ticket, a group's passengers.

## Look and accessibility

- [ ] Sharp on all three phones (no blur, no square corners, a thin light edge) at every size: chat, lists, profile.
- [ ] No empty circle or flicker when opening a list with avatars.
- [ ] VoiceOver / TalkBack in the picker: "Avatar 3 of 8" and "Avatar 3 of 8, selected" (EN/FR/ES); the Profile avatar reads "Change your avatar"; avatars next to names aren't read separately.
- [ ] Every avatar in the picker is easy to tap on the small iPhone (at least 44 pt).
