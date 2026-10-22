-- "On the way" ends once the taxi receipt is in. Only the payer (and the admin) may read the
-- receipt itself, so the group records just the moment one arrived - every member can read their
-- own group, and with it this time, never the amount or the photo.
--   - Set when a receipt is recorded; kept when it is corrected or re-photographed.
--   - Cleared when the receipt is rejected: until a new one comes in, the ride hasn't ended
--     as far as the app is concerned.
--
-- Safe to run more than once.

alter table public.taxi_groups
  add column if not exists receipt_received_at timestamptz;

create or replace function public.ride_receipts_mark_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.group_id is null then
    return new;
  end if;
  update public.taxi_groups
  set receipt_received_at = case when new.status = 'REJECTED' then null else coalesce(receipt_received_at, new.submitted_at, now()) end
  where id = new.group_id
    and receipt_received_at is distinct from (case when new.status = 'REJECTED' then null else coalesce(receipt_received_at, new.submitted_at, now()) end);
  return new;
end;
$$;

drop trigger if exists ride_receipts_mark_group on public.ride_receipts;
create trigger ride_receipts_mark_group
  after insert or update of status, submitted_at on public.ride_receipts
  for each row execute function public.ride_receipts_mark_group();

-- Receipts already in.
update public.taxi_groups g
set receipt_received_at = r.submitted_at
from public.ride_receipts r
where r.group_id = g.id
  and r.status <> 'REJECTED'
  and g.receipt_received_at is null;
