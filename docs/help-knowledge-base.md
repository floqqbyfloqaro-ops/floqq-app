# FLOQQ Help Bot Knowledge Base

Oct 23, 2026 · @Floqq

This is the single source of truth the FLOQQ help bot answers from. Every rule here reflects decisions made for the BCN pilot; anything marked **TO DECIDE** is not settled yet and the bot must not promise it.

- Write answers in passenger language, not technical terms.
- When a rule changes in the app, update it here the same day, so the bot never contradicts the app.
- The bot answers in the user's app language (EN, FR, ES); this English version is the master copy.

## What FLOQQ is

FLOQQ matches travelers landing at Barcelona Airport (BCN) around the same time and heading in compatible directions, so they can share one regular airport taxi and split the fare.

- FLOQQ does not own or operate taxis and has no drivers. Passengers take the next normal taxi at the rank together.
- FLOQQ organizes the match, the meeting point, the group badge and the fair split of the fare.
- FLOQQ charges a platform fee of **€2.49 per passenger**. It is reserved on the card when the passenger secures their spot in a group, and charged together with their taxi share after the ride. The taxi fare is separate.
- Pilot scope: BCN only, Terminal 1 and Terminal 2.

**Two ways to use it**

1. **Before landing:** enter your flight number and destination before you fly. FLOQQ looks for travelers while you are in the air and tells you the result when you land.
2. **Already landed:** open the app at the airport, choose your destination and terminal, and join travelers looking to share right now.

**The journey in the app:** request a ride → finding your match → match found (secure your spot) → group confirmed → find your group at the meeting point → on the way → ride completed.

## Account and profile

- **Minimum age: 18.** Date of birth is required at sign-up. Users under 18 cannot create an account or request rides.
- **Email verification:** new accounts must confirm their email before requesting a ride. The verification email can be resent from the waiting screen; check spam folders.
- **Sign-in options:** email and password, Apple, or Google.
- **Name:** first and last name can be edited in Profile. Other passengers only ever see the first name.
- **Email change:** done in Profile. A confirmation link is sent to the new address; the change only applies once it is confirmed, and the old email keeps working until then. Apple or Google accounts: the email is managed by Apple or Google and cannot be changed in FLOQQ.
- **Password change:** Profile → **Change password**, at any time. Enter the current password, then the new one twice (at least 8 characters, different from the current one) and tap **Save**. The user stays signed in on that phone; every other device is signed out, and an email confirms the change in the phone's language. Forgot the current password: tap **Forgot your current password?** on that screen to get a reset link by email (or **Forgot password?** on the Sign In screen). After 5 wrong current passwords in a row the user must wait 15 minutes. Apple or Google accounts have no FLOQQ password: Profile shows "Signed in with Apple/Google" instead, and the password is managed by Apple or Google.
- **Date of birth:** cannot be edited by the user once set. To correct it, the user contacts support (human handover).
- **Language:** the app follows the phone's language (EN, FR, ES supported; others fall back to English).
- **Payment method:** saved once (Apple Pay, Google Pay or card) in Profile → Payment Methods, where it can be replaced.

## Requesting a ride

| Field | Rule |
| --- | --- |
| Arrival date | Required. |
| Flight number | Optional. When entered, the arrival time is filled automatically from flight data and cannot be edited. |
| Arrival time | Filled from the flight, or typed by the user (with a "Now" option) when there is no flight number. Typed times are always Barcelona time. |
| Terminal | T1 or T2. Set automatically from the airline when a flight number is given ("Not correct?" lets the user change it). Required choice when there is no flight number. |
| Destination | Address search (Google). |
| Large luggage (max 30 kg) | 0 or 1. Counts as checked luggage. |
| Hand luggage | 0, 1 or 2. |
| Max wait for group to form | Minutes the passenger is willing to wait for the others to be ready. Not the wait for the taxi. |
| Checked luggage question | Only without a flight number: "Do you still need to collect checked luggage?" |

- **One active ride at a time.** To book another, the user views or cancels the current one first.
- **Editing:** possible while the ride is still searching or the group is not yet confirmed ("Edit" on the Finding your match screen). Once the group is confirmed, rides cannot be edited: the user cancels and creates a new request.
- Editing a ride that was in a forming group takes it out of that group and searches again with the new details.

## How matching works

FLOQQ checks for matches **every 5 minutes**; there is no guaranteed maximum wait, because a match depends on compatible travelers existing.

- **Group size:** 2 to 3 passengers per taxi.
- **Same terminal only:** T1 passengers are never grouped with T2 passengers.
- **Fair for each person:** every passenger's own limits are checked (wait time, route detour, luggage space), never an average. Detour limits: **TO DECIDE** (values pending approval).
- **Ready time** = when a passenger can realistically reach the meeting point, counted from the plane's arrival at the gate:

| Flight | No checked bag | Checked bag |
| --- | --- | --- |
| Schengen origin | +15 min | +30 min |
| Non-Schengen origin (e.g. UK, USA) | +35 min | +50 min |

- Without a flight number: ready in about 5 min, or 15 min if checked luggage is still to collect.
- **Meeting time** = the latest ready time in the group. A group only forms if nobody would wait longer than their own max wait.
- **Flight delays:** ready times update automatically. A forming group is re-checked; a confirmed group affected by a big change is reviewed by FLOQQ.
- **No match found:** if nobody compatible is found by the arrival time plus the passenger's max wait, the ride is marked **Expired – no match found**. No fee is charged, and the user can create a new request.

## Match found and securing your spot

- When a match is found, the passenger sees the group (first names, avatars, neighborhood of each destination, never exact addresses), the planned route, the estimated total fare and their estimated share.
- **"Secure my spot"** reserves an amount on the saved payment method: the estimated taxi share, the €2.49 platform fee and a buffer in case the meter runs higher. This is a temporary hold, not a charge. After the ride only the real share plus the fee is charged; the rest is released.
- A spot counts as secured only once the reservation is confirmed by the payment provider. If a payment fails, the passenger can retry or change card; there is no way to continue without paying.
- **"Not for me"** declines the match: the passenger leaves this group and the search continues. No fee is charged for declining before securing.
- **Response deadline:** a match must be accepted within a set time, shown as a countdown. Value: **TO DECIDE**. If someone doesn't respond in time, they are removed and the others are re-matched.
- The group is **confirmed** once every member has secured their spot. Only then do the meeting point and the badge become available.

## Meeting your group

- **Meeting point:** a landmark in the public arrivals hall of your terminal, after baggage claim (for example the Tourist Info desk or a café). Groups meeting at the same time get different points. The card shows a photo, directions from the baggage claim exit, the meeting time and an "Open in Google Maps" button. A closed café is still a valid meeting point: meet in front of it.
- **"Find my group":** on the Group confirmed screen. Before landing it shows a preview; after landing it starts the guidance.
- **Arrow guidance:** points to the meeting point using the phone's location, which stays on the phone. Indoors GPS can be off by 10–50 m, so near the point the app shows the photo and directions instead of the arrow.
- **"I'm at the meeting point":** one tap tells the group you have arrived. A mistaken tap can be undone.
- **Badge:** each group gets a colour, shape and number. "Show our badge" displays it full screen; hold the phone up and look for the same badge.
- **Location sharing with the group:** optional, off by default. Only group members see it, only while the meetup screen is open, and it stops automatically when the ride starts.
- **Group chat:** not available yet. To find each other, use the meeting point photo and directions, "Show our badge" and "I'm at the meeting point".
- **"I've found my group":** each member confirms. When everyone has confirmed, head to the taxi rank together and tap "We're in the taxi".
- **Someone missing:** after 10 minutes, the others can keep waiting or continue without them (marked as a no-show, at least 2 passengers must remain).

## The ride and payments

- **Two separate amounts:** the €2.49 FLOQQ fee and the passenger's share of the taxi fare. Both are reserved together when securing the spot and charged together after the ride.
- **Who pays the taxi driver:** the passenger whose stop is the last one on the route, since they are the only one still in the taxi when the meter stops. They are told before the ride. Their own share goes straight to the taxi, so FLOQQ only charges them the €2.49 fee.
- **The others' shares:** reserved on their cards when they secured their spot, then charged at the exact amount after the ride. The unused part of the hold is released.
- **Receipt:** at the end, the payer photographs the taxi receipt in the app. The app reads the total from the photo; the payer never types it. If the photo is unclear or doesn't match the ride, the FLOQQ team checks it by hand.
- **Fair split:** FLOQQ calculates each share from the real receipt total and the route: each part of the trip is shared by the passengers still in the taxi during it. Nobody pays for kilometers after they got out. Passengers don't need to do anything for this.
- **Payer reimbursement:** the payer receives the other passengers' shares through the app.
- **"On the way" screen:** informative only. FLOQQ does not track the taxi.
- **"I've arrived":** each passenger taps it when they get out; this opens the Ride completed summary. Amounts show "Pending" until the receipt is processed.
- **Rating:** optional, 1 to 5 stars; below 5 stars a short form asks what could be better.

**TO DECIDE before the bot answers these in detail:** dispute window for receipt amounts, deadline and fallback if the payer never uploads the receipt, exact terms of the Ride Payment Guarantee (whether FLOQQ covers a share that fails to be charged), and payout timing for the payer. Legal validation of the payment flow in Spain is pending.

## Cancellations, refunds and delays

| Situation | What happens |
| --- | --- |
| Cancel while still searching | Free. Ride cancelled, nothing charged. |
| Decline a match before securing | Free. Search continues. |
| No match found in time | Ride expires automatically. Nothing charged. |
| Cancel after securing the spot, before the group is confirmed | Free. The whole reservation, fee included, is released. Nothing is charged. |
| Cancel after the group is confirmed, more than 24 hours before the ride | Free. The whole reservation, fee included, is released. |
| Cancel after the group is confirmed, less than 24 hours before the ride | The €2.49 fee is charged; the rest of the reservation is released. The app shows this before the user confirms. |
| Another member cancels or doesn't show up | The group is recalculated if at least 2 remain, otherwise everyone goes back to searching. Effect on the €2.49 of those who stay: **TO DECIDE** |
| Flight delayed | Ready time updates automatically; a forming group is re-checked, a confirmed group is reviewed by FLOQQ. |
| Terminal changed by the airline | The passenger is moved to a new search at the right terminal if the group isn't confirmed yet; otherwise FLOQQ reviews it. |
| Group never met at the airport | The ride is flagged for FLOQQ review and no taxi-share payment is processed until it is resolved. |

Cancelling is done from "My Ride" or the Finding your match screen, always with a confirmation step. The bot never cancels a ride itself (see Bot rules).

## Safety, privacy and data

- **Emergencies:** in any emergency, call **112** (European emergency number) first. The bot says this immediately and does not try to handle the emergency itself.
- **What other passengers see:** first name, avatar, neighborhood of the destination, flight status and meetup status. Never surname, email, phone, exact address or date of birth.
- **Location:** used on the phone for the arrow guidance. Shared with the group only if the passenger turns it on, only during the meetup, never stored.
- **Group chat:** not available yet, so there is nothing to report or block in the app. Safety problems with another passenger go to the FLOQQ team (human handover).
- **Ratings** are never shown to other passengers.
- **Account deletion:** how to request deletion: **TO DECIDE**.
- **Payments:** card details are handled by Stripe; FLOQQ never sees or stores full card numbers.

## Troubleshooting

| Problem | What to tell the user |
| --- | --- |
| Didn't receive the verification email | Check spam, then use "Resend verification email". Still nothing → human handover. |
| Can't create a ride | Check: email verified, date of birth entered (18+), no other active ride, payment method saved. |
| Flight number not recognised | Check the format (airline code + number, e.g. VY1803) and the date. Otherwise leave it empty and enter the arrival time and terminal manually. |
| Wrong terminal shown | Tap "Not correct?" under the terminal to change it. |
| Still searching for a long time | Matching runs every 5 minutes and depends on compatible travelers. A longer max wait helps. The ride expires for free if no one is found. |
| Payment failed | Retry, or replace the card in Profile → Payment Methods. Charged but spot not secured → human handover. |
| Arrow not showing | Turn on location for FLOQQ in phone settings. Indoors, near the point, the app shows the photo and directions instead. |
| Arrow points the wrong way | Move the phone in a figure-of-eight to calibrate the compass, and hold it flat. |
| Can't find the group | Use the photo and directions, "Show our badge", and "I'm at the meeting point". |
| Amounts show "Pending" | Normal until the payer's receipt is processed; the user is notified when final. |
| Notifications not arriving | Allow notifications for FLOQQ in phone settings. |

## Bot rules

**The bot can:**

- Explain how FLOQQ works, using only this knowledge base.
- Look up the signed-in user's own information, read-only: ride status, group status, meeting point, payment and refund status.
- Guide the user to the right screen or button to do something themselves.
- Create a support ticket for the FLOQQ team, with the conversation and the ride attached.

**The bot never:**

- Cancels, edits, refunds, charges or changes anything itself.
- Shares another passenger's information.
- Promises a refund, compensation or anything marked TO DECIDE.
- Invents an answer: if it isn't in this knowledge base or the user's data, it says so and offers a human.

**Hand over to a human when:**

- the user asks for a person;
- money is involved and something looks wrong (charged twice, charged but no spot, wrong share, missing reimbursement);
- a safety problem, harassment or a dispute between passengers;
- a date of birth correction or account deletion;
- the bot couldn't solve the problem after two attempts.

**Always:** tell the user at the start that they are talking to an AI assistant, answer in their app language, and for any emergency tell them to call 112 first.

## Open decisions before launch

The bot treats each of these as "not decided yet" and hands over to a human until it is filled in above.

- [x] Refund rules for the €2.49 fee when the user cancels (as the app does it today; see the cancellation table)
- [ ] Effect of a no-show on the fee of the passengers who stay
- [ ] Match response deadline (minutes)
- [ ] Detour limits per passenger
- [ ] Dispute window for receipt amounts
- [ ] Deadline and fallback when the payer doesn't upload the receipt
- [ ] Ride Payment Guarantee terms
- [ ] Payout timing for the payer
- [ ] Legal validation of the payment flow in Spain
- [ ] Account deletion process
- [ ] Support contact details and human response time
