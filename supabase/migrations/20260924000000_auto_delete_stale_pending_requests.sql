-- Pending requests whose arrival date has already passed just sit around cluttering the admin's
-- manual-selection list forever (nothing else ever removes a 'pending' row). Compares by DATE
-- only, not time-of-day, so a request for later today is never touched - only ones from a
-- previous day. Only ever applies to status = 'pending': a 'matched' or 'cancelled' request is
-- left alone regardless of its arrival date.

-- One-off cleanup so today's already-stale rows disappear as soon as this migration runs,
-- instead of waiting for the first scheduled tick below.
delete from public.passenger_requests
where status = 'pending'
  and arrival_at::date < current_date;

-- Recurring cleanup so this keeps being true going forward. cron.schedule() upserts by job name,
-- so re-running this migration updates the existing job rather than creating a duplicate.
select cron.schedule(
  'delete-stale-pending-requests',
  '0 * * * *', -- hourly
  $$
    delete from public.passenger_requests
    where status = 'pending'
      and arrival_at::date < current_date;
  $$
);
