-- Passengers could previously only update their own request to cancel it (status = 'cancelled').
-- The "Edit" flow on Finding Your Match needs to let them update trip details too, as long as the
-- request hasn't been cancelled - it stays in 'pending' or 'matched' before and after the edit.
create policy "Users can edit their own pending or matched passenger requests"
  on public.passenger_requests
  for update
  using (auth.uid() = user_id and status in ('pending', 'matched'))
  with check (auth.uid() = user_id and status in ('pending', 'matched'));
