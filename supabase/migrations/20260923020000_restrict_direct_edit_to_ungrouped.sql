-- The "Users can edit their own pending or matched passenger requests" policy (previous
-- migration) let a client UPDATE a grouped request directly, bypassing
-- begin_passenger_request_edit()'s group rebalancing entirely - reintroducing the exact stale-
-- group bug this migration set fixes. The app itself now only edits through the
-- edit-passenger-request Edge Function (which uses that SECURITY DEFINER function and isn't
-- subject to RLS), so direct client updates only need to remain possible for the case that
-- carries no group-rebalancing risk: an ungrouped, still-pending request.
drop policy if exists "Users can edit their own pending or matched passenger requests" on public.passenger_requests;

create policy "Users can edit their own ungrouped pending passenger requests"
  on public.passenger_requests
  for update
  using (auth.uid() = user_id and status = 'pending' and group_id is null)
  with check (auth.uid() = user_id and status = 'pending' and group_id is null);
