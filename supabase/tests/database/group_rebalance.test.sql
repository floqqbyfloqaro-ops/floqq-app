-- Exercises begin_passenger_request_edit() / apply_group_rescore() directly (see
-- supabase/migrations/20260923010000_group_rebalance_on_edit.sql). These are the SQL-only
-- pieces of the edit-a-grouped-ride flow; the Google Routes recomputation itself
-- (edit-passenger-request/index.ts, computeGroupScore) is exercised separately by
-- supabase/functions/_shared/groupRebalance.test.ts (plain Node test, no network/DB needed).
--
-- Run with: supabase start (needs Docker) && supabase test db
--
-- Note on the "two members edit simultaneously" scenario (case E below): pgTAP runs a whole test
-- file in one transaction/session, so it cannot demonstrate two sessions actually blocking on the
-- same FOR UPDATE row lock - that needs two real concurrent connections. What it CAN demonstrate,
-- and what actually matters for correctness, is the optimistic-concurrency version check in
-- apply_group_rescore: simulating the interleaving as a sequence (A's begin, B's begin, then A's
-- stale apply) and asserting A's stale write is safely rejected rather than corrupting state that
-- B has already moved on.

begin;
select plan(32);

-- Minimal auth.users rows so passenger_requests.user_id's FK is satisfiable.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'p1@test.floqq'),
  ('00000000-0000-0000-0000-000000000002', 'p2@test.floqq'),
  ('00000000-0000-0000-0000-000000000003', 'p3@test.floqq'),
  ('00000000-0000-0000-0000-000000000004', 'p4@test.floqq'),
  ('00000000-0000-0000-0000-000000000005', 'p5@test.floqq'),
  ('00000000-0000-0000-0000-000000000006', 'p6@test.floqq'),
  ('00000000-0000-0000-0000-000000000007', 'p7@test.floqq'),
  ('00000000-0000-0000-0000-000000000008', 'p8@test.floqq'),
  ('00000000-0000-0000-0000-000000000009', 'p9@test.floqq'),
  ('00000000-0000-0000-0000-00000000000a'::uuid, 'p10@test.floqq'),
  ('00000000-0000-0000-0000-00000000000b'::uuid, 'p11@test.floqq'),
  ('00000000-0000-0000-0000-00000000000c'::uuid, 'p12@test.floqq'),
  ('00000000-0000-0000-0000-00000000000d'::uuid, 'p13@test.floqq');

-- Acting as a given passenger for the duration of one statement, matching Supabase's standard
-- auth.uid() implementation (reads the 'sub' claim off the request.jwt.claim.sub GUC).
create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$ language plpgsql;

-- =========================================================================================
-- Case A: group of 3 -> 1 edits -> group of 2, recalculated (not dissolved)
-- =========================================================================================
insert into public.taxi_groups (id, created_by, status, version)
values ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'unconfirmed', 0);

insert into public.passenger_requests
  (id, user_id, flight_number, arrival_at, destination_address, large_luggage_count, hand_luggage_count,
   max_wait_minutes, status, group_id, destination_lat, destination_lng)
values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'AA1', now() + interval '2 hour', 'Addr 1', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000001', 41.3, 2.1),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'AA2', now() + interval '2 hour', 'Addr 2', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000001', 41.31, 2.11),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'AA3', now() + interval '2 hour', 'Addr 3', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000001', 41.32, 2.12);

select pg_temp.act_as('00000000-0000-0000-0000-000000000001');

select is(
  (select (begin_passenger_request_edit(
    'b0000000-0000-0000-0000-000000000001', 'AA1X', now() + interval '3 hour', 'Addr 1 new', 41.4, 2.2, 1, 1, 25
  ))->>'needs_recalc')::boolean,
  true,
  'A: editing a 3-member group reports needs_recalc'
);

select is(
  (select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000001'),
  'pending', 'A: editor is requeued to pending'
);
select is(
  (select group_id from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000001'),
  null, 'A: editor has no group_id after editing'
);
select is(
  (select status from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000001'),
  'unconfirmed', 'A: group stays unconfirmed pending recalculation'
);

-- Simulates the Edge Function's phase C call after a successful Google Routes recomputation.
select is(
  (select (apply_group_rescore(
    'a0000000-0000-0000-0000-000000000001', 0, true,
    '[{"id":"b0000000-0000-0000-0000-000000000002","distance_km":5,"extra_detour_minutes":3,"waiting_minutes":4,"individual_score":10},
      {"id":"b0000000-0000-0000-0000-000000000003","distance_km":7,"extra_detour_minutes":2,"waiting_minutes":6,"individual_score":12}]'::jsonb,
    '{"total_fare":18,"worst_individual_score":12,"total_route_distance_km":12,"total_route_duration_minutes":25}'::jsonb
  ))->>'applied')::boolean,
  true, 'A: valid rescore is applied'
);
select is(
  (select total_fare from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000001'),
  18::numeric, 'A: group total_fare updated'
);
select is(
  (select version from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000001'),
  1, 'A: group version bumped after apply'
);
select is(
  (select individual_score from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000002'),
  10::numeric, 'A: remaining member score updated'
);
select is(
  (select group_id from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000003'),
  'a0000000-0000-0000-0000-000000000001', 'A: remaining members stay in the group'
);
select is(
  (select count(*)::int from public.group_events where group_id = 'a0000000-0000-0000-0000-000000000001' and event_type = 'group_recalculated'),
  1, 'A: group_recalculated event recorded'
);

-- =========================================================================================
-- Case B: group of 2 -> 1 edits -> dissolved, other member requeued
-- =========================================================================================
insert into public.taxi_groups (id, created_by, status, version)
values ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'unconfirmed', 0);

insert into public.passenger_requests
  (id, user_id, flight_number, arrival_at, destination_address, large_luggage_count, hand_luggage_count,
   max_wait_minutes, status, group_id, destination_lat, destination_lng)
values
  ('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'BB1', now() + interval '2 hour', 'Addr 4', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000002', 41.3, 2.1),
  ('b0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000005', 'BB2', now() + interval '2 hour', 'Addr 5', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000002', 41.31, 2.11);

select pg_temp.act_as('00000000-0000-0000-0000-000000000004');

select is(
  (select (begin_passenger_request_edit(
    'b0000000-0000-0000-0000-000000000004', 'BB1X', now() + interval '3 hour', 'Addr 4 new', 41.5, 2.3, 0, 1, 15
  ))->>'dissolved')::boolean,
  true, 'B: editing a 2-member group dissolves it immediately (no recalc needed)'
);
select is(
  (select status from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000002'),
  'dissolved', 'B: group marked dissolved'
);
select is(
  (select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000005'),
  'pending', 'B: remaining member requeued to pending'
);
select is(
  (select group_id from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000005'),
  null, 'B: remaining member detached from the dissolved group'
);
select is(
  (select count(*)::int from public.group_events where group_id = 'a0000000-0000-0000-0000-000000000002' and event_type = 'group_dissolved'),
  1, 'B: group_dissolved event recorded'
);

-- =========================================================================================
-- Case C: group of 3 -> 1 edits -> remaining 2 no longer compatible -> dissolved
-- =========================================================================================
insert into public.taxi_groups (id, created_by, status, version)
values ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 'unconfirmed', 0);

insert into public.passenger_requests
  (id, user_id, flight_number, arrival_at, destination_address, large_luggage_count, hand_luggage_count,
   max_wait_minutes, status, group_id, destination_lat, destination_lng)
values
  ('b0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000006', 'CC1', now() + interval '2 hour', 'Addr 6', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000003', 41.3, 2.1),
  ('b0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000007', 'CC2', now() + interval '2 hour', 'Addr 7', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000003', 41.31, 2.11),
  ('b0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000008', 'CC3', now() + interval '2 hour', 'Addr 8', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000003', 41.32, 2.12);

select pg_temp.act_as('00000000-0000-0000-0000-000000000006');
select begin_passenger_request_edit('b0000000-0000-0000-0000-000000000006', 'CC1X', now() + interval '3 hour', 'Addr 6 new', 41.6, 2.4, 0, 1, 10);

-- The Edge Function decided (via isGroupStillValid) that the recomputed group no longer clears
-- everyone's constraints - still_valid=false, so apply_group_rescore dissolves instead.
select is(
  (select (apply_group_rescore('a0000000-0000-0000-0000-000000000003', 0, false, '[]'::jsonb, '{}'::jsonb))->>'dissolved')::boolean,
  true, 'C: no-longer-compatible rescore dissolves the group'
);
select is(
  (select status from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000003'),
  'dissolved', 'C: group marked dissolved'
);
select is(
  (select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000007'),
  'pending', 'C: first remaining member requeued'
);
select is(
  (select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000008'),
  'pending', 'C: second remaining member requeued'
);

-- =========================================================================================
-- Case D: edit attempted on a CONFIRMED group -> blocked, no writes at all
-- =========================================================================================
insert into public.taxi_groups (id, created_by, status, version)
values ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000009', 'confirmed', 0);

insert into public.passenger_requests
  (id, user_id, flight_number, arrival_at, destination_address, large_luggage_count, hand_luggage_count,
   max_wait_minutes, status, group_id, destination_lat, destination_lng)
values
  ('b0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000009', 'DD1', now() + interval '2 hour', 'Addr 9', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000004', 41.3, 2.1),
  ('b0000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'DD2', now() + interval '2 hour', 'Addr 10', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000004', 41.31, 2.11);

select pg_temp.act_as('00000000-0000-0000-0000-000000000009');

select is(
  (select (begin_passenger_request_edit(
    'b0000000-0000-0000-0000-000000000009', 'DD1X', now() + interval '3 hour', 'should not save', 41.9, 2.9, 1, 2, 30
  ))->>'reason'),
  'group_confirmed', 'D: editing a request in a confirmed group is blocked'
);
select is(
  (select flight_number from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000009'),
  'DD1', 'D: no partial write happened to the editor''s row'
);
select is(
  (select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-000000000009'),
  'matched', 'D: editor''s status is untouched'
);
select is(
  (select status from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000004'),
  'confirmed', 'D: group status is untouched'
);

-- =========================================================================================
-- Case E: two members of the same group "edit simultaneously" - sequential simulation of the
-- interleaving (see the note at the top of this file for why pgTAP can't test real concurrent
-- sessions). Validates that a stale rescore is safely discarded rather than corrupting state a
-- second, later edit has already moved on.
-- =========================================================================================
insert into public.taxi_groups (id, created_by, status, version)
values ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000000b'::uuid, 'unconfirmed', 0);

insert into public.passenger_requests
  (id, user_id, flight_number, arrival_at, destination_address, large_luggage_count, hand_luggage_count,
   max_wait_minutes, status, group_id, destination_lat, destination_lng)
values
  ('b0000000-0000-0000-0000-00000000000b'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 'EE1', now() + interval '2 hour', 'Addr 11', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000005', 41.3, 2.1),
  ('b0000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000c'::uuid, 'EE2', now() + interval '2 hour', 'Addr 12', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000005', 41.31, 2.11),
  ('b0000000-0000-0000-0000-00000000000d'::uuid, '00000000-0000-0000-0000-00000000000d'::uuid, 'EE3', now() + interval '2 hour', 'Addr 13', 0, 1, 20, 'matched', 'a0000000-0000-0000-0000-000000000005', 41.32, 2.12);

-- Editor A begins first: group still has 2 left (B, C), no dissolve yet, version still 0.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b'::uuid);
select is(
  (select (begin_passenger_request_edit(
    'b0000000-0000-0000-0000-00000000000b'::uuid, 'EE1X', now() + interval '3 hour', 'Addr 11 new', 41.7, 2.5, 0, 1, 15
  ))->>'needs_recalc')::boolean,
  true, 'E: editor A''s begin reports needs_recalc against a 2-member remainder'
);

-- Before A's rescore is applied, editor B also edits. Only C is left afterwards -> dissolves
-- immediately, bumping the group's version.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c'::uuid);
select is(
  (select (begin_passenger_request_edit(
    'b0000000-0000-0000-0000-00000000000c'::uuid, 'EE2X', now() + interval '3 hour', 'Addr 12 new', 41.8, 2.6, 0, 1, 15
  ))->>'dissolved')::boolean,
  true, 'E: editor B''s begin dissolves the now-1-member group'
);
select is(
  (select version from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000005'),
  1, 'E: group version bumped by B''s dissolve'
);

-- A's (now stale) rescore, computed back when the group still had B+C, tries to apply against
-- the version it was handed (0) - must be rejected rather than reviving the dissolved group.
select is(
  (select (apply_group_rescore(
    'a0000000-0000-0000-0000-000000000005', 0, true,
    '[{"id":"b0000000-0000-0000-0000-00000000000c","distance_km":5,"extra_detour_minutes":3,"waiting_minutes":4,"individual_score":10},
      {"id":"b0000000-0000-0000-0000-00000000000d","distance_km":7,"extra_detour_minutes":2,"waiting_minutes":6,"individual_score":12}]'::jsonb,
    '{"total_fare":18,"worst_individual_score":12,"total_route_distance_km":12,"total_route_duration_minutes":25}'::jsonb
  ))->>'reason'),
  'stale', 'E: A''s stale apply is rejected instead of overwriting B''s dissolve'
);

-- Final state: all three original members ended up requeued, and the group stayed dissolved -
-- consistent, no half-updated group, no lost passenger.
select is((select status from public.taxi_groups where id = 'a0000000-0000-0000-0000-000000000005'), 'dissolved', 'E: final group state is dissolved');
select is((select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-00000000000b'::uuid), 'pending', 'E: editor A requeued');
select is((select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-00000000000c'::uuid), 'pending', 'E: editor B requeued');
select is((select status from public.passenger_requests where id = 'b0000000-0000-0000-0000-00000000000d'::uuid), 'pending', 'E: never-edited member C requeued too');
select is((select group_id from public.passenger_requests where id = 'b0000000-0000-0000-0000-00000000000d'::uuid), null, 'E: member C detached from the dissolved group');

select * from finish();
rollback;
