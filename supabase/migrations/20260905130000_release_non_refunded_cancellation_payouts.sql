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

  update public.drimli_payout_commitments
    set eligible_at = now(), updated_at = now()
    where appointment_id = p_appointment_id
      and status = 'pending'
      and refunded_amount = 0
      and payable_amount > 0;
  return true;
end;
$$;

create or replace function public.claim_drimli_payout_batch(
  p_batch_id uuid,
  p_provider_id uuid,
  p_stripe_account_id text,
  p_currency text,
  p_idempotency_key text,
  p_now timestamptz
)
returns public.drimli_payout_batches
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare result public.drimli_payout_batches;
declare total_amount bigint;
begin
  perform 1 from public.drimli_payout_commitments c
    join public.appointments a on a.id = c.appointment_id
    where c.provider_id = p_provider_id
      and c.currency = upper(p_currency)
      and c.status = 'pending'
      and c.payable_amount > 0
      and c.eligible_at <= p_now
      and (
        a.status = 'confirmed'
        or (
          a.status = 'cancelled_by_provider'
          and c.refunded_amount = 0
          and not exists (
            select 1 from public.drimli_refunds succeeded_refund
            where succeeded_refund.payment_id = c.payment_id
              and succeeded_refund.status = 'succeeded'
          )
        )
      )
      and not exists (
        select 1 from public.drimli_refunds r
        where r.payment_id = c.payment_id and r.status not in ('succeeded', 'failed', 'canceled')
      )
    for update of c skip locked;

  select coalesce(sum(c.payable_amount), 0) into total_amount
  from public.drimli_payout_commitments c
  join public.appointments a on a.id = c.appointment_id
  where c.provider_id = p_provider_id
    and c.currency = upper(p_currency)
    and c.status = 'pending'
    and c.payable_amount > 0
    and c.eligible_at <= p_now
    and (
      a.status = 'confirmed'
      or (
        a.status = 'cancelled_by_provider'
        and c.refunded_amount = 0
        and not exists (
          select 1 from public.drimli_refunds succeeded_refund
          where succeeded_refund.payment_id = c.payment_id
            and succeeded_refund.status = 'succeeded'
        )
      )
    )
    and not exists (
      select 1 from public.drimli_refunds r
      where r.payment_id = c.payment_id and r.status not in ('succeeded', 'failed', 'canceled')
    );

  if total_amount <= 0 then return null; end if;

  insert into public.drimli_payout_batches(
    id, provider_id, stripe_account_id, currency, amount, idempotency_key
  ) values (
    p_batch_id, p_provider_id, p_stripe_account_id, upper(p_currency), total_amount, p_idempotency_key
  ) returning * into result;

  insert into public.drimli_payout_allocations(batch_id, commitment_id, payment_id, amount)
  select p_batch_id, c.id, c.payment_id, c.payable_amount
  from public.drimli_payout_commitments c
  join public.appointments a on a.id = c.appointment_id
  where c.provider_id = p_provider_id
    and c.currency = upper(p_currency)
    and c.status = 'pending'
    and c.payable_amount > 0
    and c.eligible_at <= p_now
    and (
      a.status = 'confirmed'
      or (
        a.status = 'cancelled_by_provider'
        and c.refunded_amount = 0
        and not exists (
          select 1 from public.drimli_refunds succeeded_refund
          where succeeded_refund.payment_id = c.payment_id
            and succeeded_refund.status = 'succeeded'
        )
      )
    )
    and not exists (
      select 1 from public.drimli_refunds r
      where r.payment_id = c.payment_id and r.status not in ('succeeded', 'failed', 'canceled')
    );

  update public.drimli_payout_commitments c
    set status = 'reserved', payout_batch_id = p_batch_id, updated_at = now()
    where exists (
      select 1 from public.drimli_payout_allocations a
      where a.batch_id = p_batch_id and a.commitment_id = c.id
    );
  return result;
end;
$$;

revoke all on function public.cancel_paid_appointment_without_refund(uuid, uuid),
  public.claim_drimli_payout_batch(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.cancel_paid_appointment_without_refund(uuid, uuid),
  public.claim_drimli_payout_batch(uuid, uuid, text, text, text, timestamptz)
  to service_role;

commit;
