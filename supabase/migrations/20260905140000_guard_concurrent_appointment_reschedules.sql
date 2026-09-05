begin;

create or replace function public.reschedule_paid_appointment_guarded(
  p_appointment_id uuid,
  p_provider_id uuid,
  p_expected_start timestamptz,
  p_new_start timestamptz,
  p_new_end timestamptz,
  p_now timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare appointment_row public.appointments;
declare commitment_row public.drimli_payout_commitments;
begin
  select * into appointment_row from public.appointments
    where id = p_appointment_id and provider_id = p_provider_id for update;
  if appointment_row.id is null or appointment_row.status <> 'confirmed' then
    raise exception 'appointment is not movable';
  end if;
  if appointment_row.start_datetime is distinct from p_expected_start then
    raise exception 'appointment changed concurrently';
  end if;
  if p_new_start <= p_now or p_new_end <= p_new_start then
    raise exception 'invalid appointment range';
  end if;

  select * into commitment_row from public.drimli_payout_commitments
    where appointment_id = p_appointment_id for update;
  if commitment_row.id is not null then
    if commitment_row.status in ('reserved', 'submitted', 'paid', 'cancelled', 'refund_processing') then
      raise exception 'payment state prevents rescheduling';
    end if;
    if commitment_row.policy_snapshot in ('flexible', 'moderate')
       and p_new_end > commitment_row.created_at + interval '80 days' then
      raise exception 'refundable booking exceeds payout holding limit';
    end if;
  end if;

  insert into public.appointment_reschedule_audit(
    appointment_id, provider_id, old_start_datetime, old_end_datetime,
    new_start_datetime, new_end_datetime
  ) values (
    appointment_row.id, appointment_row.provider_id,
    appointment_row.start_datetime, appointment_row.end_datetime,
    p_new_start, p_new_end
  );

  update public.appointments
    set start_datetime = p_new_start, end_datetime = p_new_end
    where id = appointment_row.id
    returning * into appointment_row;

  update public.drimli_payout_commitments
    set eligible_at = case
          when policy_snapshot in ('flexible', 'moderate') then p_new_end + interval '15 minutes'
          else eligible_at
        end,
        updated_at = now()
    where appointment_id = appointment_row.id and status = 'pending';
  return appointment_row;
end;
$$;

revoke all on function public.reschedule_paid_appointment_guarded(
  uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.reschedule_paid_appointment_guarded(
  uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz
) to service_role;

commit;
