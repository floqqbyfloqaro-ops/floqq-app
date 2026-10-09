# Find your group: manual test checklist

A manual test of the meetup at the airport: the arrow to the meeting point, "I'm at the meeting
point", location sharing with the group, the badge, "I've found my group", leaving a no-show
behind, and the start of the ride.

It needs two or three phones. Allow about 90 minutes: several steps wait for a clock (the first
landing, 10 minutes after the first confirmation, 45 minutes after the planned departure).

## What you need

- 3 passenger accounts (A, B, C) plus the admin account.
- The current development build on each phone, and `npx expo start --dev-client` running on your
  computer (add `--tunnel` for a phone on another network).
- At least one **verified, active meeting point** at the terminal you test with (Admin -> Points).
  Without one there is no arrow and no meeting point card. Note its coordinates from the editor:
  you need them to place the mocked GPS.
- For the security check at the end: the three accounts' logins in `.env.meetup-test.local`.

### Which phone for what

| Phone | Good for | Not good for |
| --- | --- | --- |
| Real iPhone or Android phone | The arrow (it needs a real compass), haptics, brightness, permissions, real indoor GPS | Exact distances: you can't choose where the GPS says you are |
| Android emulator | Exact distances: you set the GPS position yourself | The arrow (no reliable compass), poor GPS accuracy (the emulator reports a good one) |

The iOS Simulator needs a Mac and its own simulator build, so this checklist doesn't use it. If
you have one: **Features -> Location -> Custom Location...** sets the position there.

### Mocking the GPS in the Android emulator

1. Install the development APK in an emulator whose system image includes Google Play services
   (drag the APK onto the emulator window).
2. Open the emulator's **... (Extended controls) -> Location**.
3. Type a latitude and longitude, then **Set location**. Each time you change it, the app gets a
   new position within a second or two.

To stand a known distance **north** of the meeting point, keep its longitude and add this to its
latitude:

| Distance from the point | Add to the latitude |
| --- | --- |
| 5 m | 0.000045 |
| 10 m | 0.00009 |
| 20 m | 0.00018 |
| 30 m | 0.00027 |
| 40 m | 0.00036 |
| 100 m | 0.0009 |
| 300 m | 0.0027 |

### The clocks

| What | When |
| --- | --- |
| Sharing and "I'm at the meeting point" become available | When the first member's landing time has passed |
| "Continue without ..." is offered | 10 minutes after the first "I've found my group" |
| Planned departure | The last member's landing time + 10 minutes |
| Sharing ends by itself; the meetup is closed | 45 minutes after the planned departure |

## 1. Set up the group

- [ ] With A, B and C, create rides at the **same terminal**, landing **5 to 10 minutes from
      now**, a few minutes apart, with destinations in the same direction.
- [ ] Get them into one confirmed group (Admin: Suggest groups -> Create group -> confirm, or let
      each passenger secure their spot).
- [ ] Within a minute, Admin -> the group shows a **meeting point**, a **meeting time** and a
      **badge** (colour and number), and "Group not found yet".
- [ ] Each passenger's My Ride card shows **Meet at: ...** and a **Find your group** button.

## 2. Before the first landing

Open **Find your group** on phone A before the first landing time.

- [ ] The text says location sharing opens when the first traveler lands, with a time.
- [ ] The meeting point card shows the terminal (large), photo, name, directions and
      "Meeting time ... (Barcelona time)".
- [ ] **Show our badge** is there and opens the badge.
- [ ] There is **no** "I'm at the meeting point" button and **no** share button yet.
- [ ] If location is already allowed, the arrow is already shown (guidance only uses your own
      phone).

Wait until the first landing time has passed. Within about 10 seconds:

- [ ] "I'm at the meeting point" and "Share my location with my group" appear.

## 3. Location permission

Do each of these on a real phone. Change the permission in the phone's settings, then return to
the app (it re-checks when it comes back to the foreground).

### Never asked

Use a fresh install, or reset the app's location permission.

- [ ] A card explains that the arrow can guide you and that your location **stays on your
      phone**, with **Use my location for directions**.
- [ ] Tapping it shows the system prompt. No prompt appeared before you tapped.

### Allowed

- [ ] The arrow panel appears by itself, without tapping "share".
- [ ] The other phones do **not** show you as sharing.

### Denied

- [ ] A card says FLOQQ isn't allowed to use your location, with **Open settings**.
- [ ] The meeting point card, **Show our badge** and **I'm at the meeting point** are all still
      there and work.
- [ ] Tapping "Share my location with my group" does not start sharing.

### Approximate only (iPhone: Precise Location off)

- [ ] A card says the location is too rough and asks you to turn on Precise Location.
- [ ] No arrow is shown. The card, the badge and the arrival button still work.

## 4. Guidance states

### On the Android emulator (exact distances)

Set the GPS to each position north of the meeting point and check what the top of the screen
shows. The arrow itself may show the compass hint here; that is expected in an emulator.

These steps assume the emulator reports an accuracy of 10 m or better. To see what it reports,
turn on sharing: your own line in the members list shows "accurate to ... m". If it reports worse
than 15 m you will see "Approx." distances instead, and worse than 10 m there is no automatic
arrival - which is the app behaving correctly for that accuracy, not a failure.

- [ ] **300 m:** "To: [name]" and "300 m away".
- [ ] **100 m:** "100 m away".
- [ ] **40 m:** "40 m away" (steps of 5 m below 100 m).
- [ ] **20 m:** "You're almost there", the photo and **Show our badge**. No arrow.
- [ ] **30 m:** still "You're almost there" (you only leave beyond 35 m).
- [ ] **40 m:** back to the distance.
- [ ] **5 m,** and stay there for a few seconds: the app marks you as arrived by itself, shows
      "You've arrived", and opens the badge once.

### On a real phone (the arrow, and poor GPS)

- [ ] Outdoors, hold the phone flat and turn around slowly: the arrow keeps pointing at the same
      place and turns smoothly, without spinning the long way round when you face north.
- [ ] Walk towards the point: the distance counts down.
- [ ] The screen does not dim or lock while the arrow is shown.
- [ ] Entering "You're almost there" gives one light haptic tap.
- [ ] Indoors or wherever the GPS is poor, far from the point: "Approx. ... m" with the arrow.
- [ ] Indoors, close to the point: "You're close - look around", the photo and the written
      directions, with no arrow.
- [ ] If the compass is unreliable: a hint to move the phone in a figure of eight replaces the
      arrow; the distance is still shown.

## 5. "I'm at the meeting point"

- [ ] On phone B, with location **denied**, tap **I'm at the meeting point**. It becomes
      "You're at the meeting point ✓" with a small **Undo** link, and the badge opens once.
- [ ] Phones A and C show B as "At the meeting point" within about 15 seconds.
- [ ] Tap **Undo** on B: the button returns, and A and C show B as not arrived.
- [ ] Tap it again on B: arrived again, but the badge does **not** open by itself a second time.
- [ ] On the emulator, after an automatic arrival tap **Undo** while still at 5 m: it stays
      undone (no immediate automatic arrival again) until you leave and reopen the screen.

## 6. Sharing with the group

- [ ] On A, tap **Share my location with my group**: our own explanation appears first ("Share
      your live location with your group only..."). Accept.
- [ ] A shows "You're sharing your location · accurate to ... m". B and C show A as "Sharing
      live location".
- [ ] Tap share on A again later (after stopping): no explanation the second time for this group.
- [ ] Put A's app in the **background**: B and C show "Last seen just now", then minutes.
- [ ] Bring A back: sharing resumes by itself.
- [ ] Tap **Stop sharing** on A, background the app and return: it stays off. The arrow still
      works.
- [ ] On C, never share: A and B show "C isn't sharing their location", and C still sees A's
      status.

## 7. A member cancels mid-meetup

Use a separate group for this, or do it last: it changes the group.

- [ ] While A and B are on the meetup screen and C is sharing, cancel C's ride (My Ride ->
      Cancel ride).
- [ ] A and B: C disappears from the members list within about 15 seconds.
- [ ] C: the meetup screen says they are no longer in a confirmed group; C's sharing has stopped.
- [ ] If only one passenger remains, the group is dissolved and that passenger's screen says so
      too.

## 8. The badge

- [ ] **Show our badge** on all three phones: the same colour, shape and number on each.
- [ ] The badge pulses gently, and the screen goes to full brightness.
- [ ] Go back: the brightness returns to what it was.
- [ ] The badge works with location denied.
- [ ] Confirm a second group at the same meeting point around the same time: it has a
      **different colour**.
- [ ] Admin -> the group shows the same badge colour and number.

## 9. "I've found my group"

### Everyone confirms

- [ ] On A's badge screen tap **I've found my group**: A shows "Found ✓"; B and C see it within
      about 15 seconds. A sees "Waiting for the others to confirm."
- [ ] B and C confirm: all three see "Everyone's together" and "Head to the taxi rank together."
- [ ] Sharing has stopped on every phone, and the share button is gone.
- [ ] Admin -> the group shows "Group found".

### Someone doesn't show up (three members)

Use a fresh group of three.

- [ ] A and B confirm; C does not. Before 10 minutes have passed, A and B only see "Waiting for
      the others to confirm."
- [ ] 10 minutes after the first confirmation, A and B see "C hasn't confirmed yet" with **Keep
      waiting** and **Continue without C**.
- [ ] **Keep waiting** hides the choice; it comes back after about 5 minutes.
- [ ] **Continue without C** asks for confirmation first. Confirm it.
- [ ] A and B now see "Everyone's together". C gets a notification and is no longer in the group.
- [ ] Admin: C appears in the pending list marked as a **no-show** (until C's ride expires, which
      can be within minutes because its landing time has passed), and the group's fare shares are
      recalculated for two passengers.

### Someone doesn't show up (two members)

Use a group of two.

- [ ] A confirms; B does not. After 10 minutes A sees that at least two passengers have to
      remain: **Keep waiting** only, no "Continue without".

## 10. The start of the ride

- [ ] After "Everyone's together", tap **We're in the taxi**: it asks "Are you all in the taxi?".
- [ ] **Not yet** changes nothing.
- [ ] **Yes, we're in the taxi**: every phone shows that the ride has started; the badge and
      arrival buttons are gone.
- [ ] Admin -> the group shows "Ride started".

## 11. A group that never meets

Use a group you leave alone. This takes until 45 minutes after its planned departure.

- [ ] Nobody taps "I've found my group". 45 minutes after the planned departure, the dashboard
      shows the group as **Needs review: this group never met**.
- [ ] With payments on: the payer can no longer send a receipt for it, and nothing is charged.
- [ ] Admin -> the group -> **The ride took place**: the flag disappears and the group shows
      "Ride started".
- [ ] A group that **was** found but never tapped "We're in the taxi" is marked as started by
      itself at the same moment, with no flag.

## 12. Privacy and security

- [ ] In Supabase, table `group_events`: the rows `location_sharing_started`,
      `location_sharing_stopped`, `arrived_at_meeting_point` and `arrival_undone` hold a reason or
      a source in `details`, and **no coordinates** anywhere.
- [ ] `passenger_requests` has an arrival time and source (MANUAL or AUTO) for members who
      arrived, and no location columns for it.
- [ ] Run the channel security test with two members of a confirmed group that is still meeting,
      and one outsider:

      ```
      node --env-file=.env --env-file=.env.meetup-test.local scripts/meetup-channel-security-test.mjs
      ```

      Every line prints PASS: the members join and hear each other; the outsider is rejected,
      hears nothing, and can't send into the group.
- [ ] Run it again after that group has been found: the members are now rejected too.

## Notes

| Step | Phone | What happened | Expected |
| --- | --- | --- | --- |
| | | | |
| | | | |
| | | | |
