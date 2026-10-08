# Payments prototype: end-to-end test checklist

A manual test of the whole payment flow with 3 test accounts and Stripe test cards. Stripe must be
in the sandbox and payments switched on (`PAYMENTS_ENABLED=true` in Supabase and
`EXPO_PUBLIC_PAYMENTS_ENABLED=true` in the app's `.env`).

Plan about 4.5 hours from start to finish, most of it waiting: the ride has to start before a
receipt can be sent, and the cards are charged 2 hours after the receipt is accepted.

## What you need

- 3 passenger accounts (A, B, C) plus the admin account.
- The app on a phone (cards can only be added in the mobile app, not on the web).
- A photo of any real taxi receipt (an old one is fine).
- The Stripe sandbox dashboard open in a browser.

| Account | Role in this test | Card number |
| --- | --- | --- |
| A | Pays the taxi (gets off last) | 4242 4242 4242 4242 |
| B | Bank verification (3D Secure) | 4000 0027 6000 3184 |
| C | Declined card, then a good one | 4000 0000 0000 0341, later 4242 4242 4242 4242 |

For every card: any future expiry date, any 3-digit security code, any postcode.

## 1. Save the cards

For each account: **Profile → Payment methods → Add payment method**.

- [ ] A: card is saved, shown as "Visa •••• 4242".
- [ ] B: the bank's test verification page appears; approve it. Card is saved, "•••• 3184".
- [ ] C: card 0341 is saved without any error, "•••• 0341". (This card saves fine and only fails
      when money is reserved.)
- [ ] Stripe: under **Customers** there is a customer for each account with a saved card.

## 2. Create and confirm the group

- [ ] With each account, create a ride request arriving **about 2 hours from now**, all within a
      few minutes of each other. Give A the destination farthest from the airport, so A is the
      payer.
- [ ] Admin: **Suggest groups → Create group** (or tick the three requests and tap
      **Create group**), then **Confirm group**.
- [ ] Admin, group page: the new **Payments** card lists A, B and C as "Not reserved yet", and A
      has "pays the taxi" next to their name.
- [ ] Admin dashboard: the group shows "Payments: 0 of 3 reserved".

## 3. Reserve the seats (holds)

On **My ride**, each account sees "Reserve your seat". The amount is the estimated share, plus the
€2.49 FLOQQ fee, plus a buffer (25% of the share, at least €5).

- [ ] A: tap **Reserve €…**. The message "€… reserved" appears.
- [ ] B: tap **Reserve €…**, approve the bank's verification page. The seat is reserved.
- [ ] C: tap **Reserve €…**. It fails: "Your card couldn't be reserved. Try again, or replace your
      card in Profile."
- [ ] Admin, group page: A and B show "Reserved", C shows "Reservation failed" with a reason.
- [ ] Admin dashboard: "Payments: 2 of 3 reserved · 1 failed".
- [ ] Stripe, **Payments**: two payments with status "Uncaptured" and one failed payment.

## 4. Failure scenario: fix the declined card

- [ ] C: **Profile → Replace card**, enter 4242 4242 4242 4242.
- [ ] C: back on **My ride**, tap **Reserve €…** again. The seat is reserved.
- [ ] Admin, group page: all three show "Reserved". Dashboard: "Payments: 3 of 3 reserved".

Do this within 60 minutes of confirming the group (and at least 30 minutes before the ride).
A passenger who has not reserved by then is removed from the group.

## 5. Payer sets up their payout

- [ ] A: **My ride** shows "You're paying the taxi". Tap **Set up payout** and complete the Stripe
      form with test data, the same way as in the Phase 4 test.
- [ ] A: back in the app, "Payout set up ✓" appears (tap **Check again** if it does not yet).
- [ ] Admin, group page, Payments card: under **Payer**, "payout account: ready".

## 6. Send the receipt

Wait until the ride's start time has passed. Before that the app says "The ride hasn't started
yet".

- [ ] A: **My ride → Photograph the receipt**, take the photo of the taxi receipt.
- [ ] An old receipt has the wrong date, so A sees "FLOQQ is checking this receipt by hand".
- [ ] Admin dashboard: **Payment problems** shows "Receipt waiting for your review".
- [ ] Admin, group page, **Taxi receipt** card: **View receipt photo**, type a total close to the
      estimated fare, and approve.
- [ ] Admin, Payments card: under **Receipt**, the total, "Accepted" and "Cards are charged
      {time}" (2 hours after approval).
- [ ] B and C: **My ride** shows their final share and when it will be charged.

## 7. Capture and release

Wait until the time shown under "Cards are charged". The charges run within 5 minutes after it.

- [ ] Admin, group page: A, B and C show "Charged", each with "charged €…" and "released €…".
      For A (the payer) the charged amount is only the €2.49 fee.
- [ ] Admin dashboard: "Payments: 3 of 3 charged".
- [ ] B and C: **My ride** shows "your share €… + €2.49 FLOQQ fee - paid. €… released."
- [ ] Stripe, **Payments**: the three payments are "Succeeded", each for less than the amount
      first reserved (the difference is the released part).

## 8. Transfer to the payer

- [ ] Admin, group page, **Transfers to the payer**: "€X of €X sent · sent", with a transfer ID
      under B and under C. **Ride Payment Guarantee** says "Not used".
- [ ] Admin dashboard: the group's payment line ends with "payout sent".
- [ ] A: **My ride** shows "€… on its way to you."
- [ ] Stripe, **Connect → Connected accounts → A's account**: two incoming transfers that add up
      to B's share plus C's share.

## 9. Check the totals

- [ ] B's share + C's share + A's own share = the receipt total.
- [ ] The amount sent to A = the receipt total minus A's own share.
- [ ] FLOQQ keeps 3 × €2.49.

## Optional extra scenarios

- **Passenger never fixes a failed reservation:** skip step 4. After the deadline C is removed
  from the group and the shares of A and B are recalculated.
- **Card refused when saving:** adding card 4000 0000 0000 0002 fails straight away with "We
  couldn’t save your card."
- **No receipt:** skip step 6. After reminders, FLOQQ charges the estimated fare, and the payout
  appears under **Payment problems** as held until you tap **Approve and send payout**.
- **Cancelling:** a passenger cancels their seat after reserving. More than 24 hours before the
  ride the whole reservation is released; later, the €2.49 fee is charged.
