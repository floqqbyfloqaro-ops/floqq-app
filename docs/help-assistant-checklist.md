# Help assistant – checks on a phone

What `scripts/help-eval-test.mjs` can't check: do these by hand on a real phone (iPhone and Android,
one of them small, e.g. iPhone SE), with `npm run start` (test project). Tick each in EN, FR and ES
where it says so.

## Opening and the conversation

- [ ] Profile → Help slides in from the right (about a quarter of a second); Back returns to Profile.
- [ ] "FLOQQ Assistant" with the AI badge, the AI line, "Hi {first name}, how can I help?" (EN/FR/ES).
- [ ] With a ride: the ride card with its status and "Help with this ride"; the suggested questions follow the ride (searching / group found / meeting / completed).
- [ ] An answer appears word by word, with the typing dots before the first word; links, bold and numbered steps look right.
- [ ] Ride / payment / refund cards show the real figures; each button opens the right screen and changes nothing by itself.
- [ ] Leave and come back within 24 hours: the conversation is still there. "New conversation" starts a fresh one.
- [ ] Thumbs up / down; thumbs down asks "What was missing?".

## Handover and tickets

- [ ] "Did this solve your problem?" → Yes: "Glad we could help". → No: the team options inline.
- [ ] "Talk to a person" is always there until a ticket is open.
- [ ] Call back: country picker with flags, invalid number refused, consent box, time slots; the ticket card appears.
- [ ] WhatsApp (once a number is set in Admin → Help → Overview): opens WhatsApp with only "#REF".
- [ ] The ticket card updates by itself (about every 20 seconds) when the admin changes the ticket.
- [ ] "Your requests" lists earlier tickets.
- [ ] A message with "accident" / "accidente" / "accident" shows the "Call 112" card before the answer; the button calls 112.

## Typing, offline, errors

- [ ] The input grows to 4 lines, then scrolls; the counter appears near the 1000-character limit.
- [ ] The keyboard never covers the input or the last answer (small phone!); dragging the list closes it.
- [ ] Type something, leave Help, come back: the text is still there.
- [ ] Airplane mode: "You're offline"; a message sent stays "Waiting to send" and goes out by itself when back online.
- [ ] (Test project) Remove the ANTHROPIC_API_KEY secret for a moment: "Try again" after the first failure; after the second, the team is offered and the suggested questions give the written answer. Put the key back.

## Accessibility

- [ ] VoiceOver / TalkBack: header, badge, every button and card are read out with a sensible label; a finished answer is announced once (not word by word).
- [ ] Largest text size: nothing is cut off, buttons still fit, the ride card wraps.
- [ ] "Reduce motion" on: no slide-in, no typing-dot animation, no streaming flicker.
- [ ] Dark theme throughout, contrast readable in sunlight.

## Admin

- [ ] Admin → Help → Overview: this month's figures, the WhatsApp vs call back bar, the reasons, thumbs down with the question.
- [ ] Support settings: WhatsApp number, alert email, languages, retention days save; wrong values are refused.
