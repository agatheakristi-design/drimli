begin;

create or replace function public.cancel_paid_appointment_without_refund(
  p_appointment_id uuid,
  p_provider_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare commitment_status text;
begin
  select status into commitment_status from public.drimli_payout_commitments
    where appointment_id = p_appointment_id for update;
  if commitment_status in ('reserved', 'submitted', 'paid', 'refund_processing') then
    return false;
  end if;

  update public.appointments set status = 'cancelled_by_provider'
    where id = p_appointment_id and provider_id = p_provider_id and status = 'confirmed';
  if not found then return false; end if;

  -- No client refund means the provider remains economically entitled to the
  -- existing payout. Keep its original eligibility and amount unchanged.
  return true;
end;
$$;

revoke all on function public.cancel_paid_appointment_without_refund(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_paid_appointment_without_refund(uuid, uuid)
  to service_role;

commit;
