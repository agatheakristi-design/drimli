begin;

alter table public.profiles
  add column if not exists drimli_payout_mode text not null default 'automatic'
    check (drimli_payout_mode in ('automatic', 'manual'));

create table public.drimli_payout_batches (
  id uuid primary key,
  provider_id uuid not null references auth.users(id) on delete restrict,
  stripe_account_id text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount bigint not null check (amount > 0),
  status text not null default 'processing'
    check (status in ('processing', 'submitted', 'paid', 'failed')),
  idempotency_key text not null unique,
  stripe_payout_id text null unique,
  stripe_status text null,
  last_error text null,
  created_at timestamptz not null default now(),
  paid_at timestamptz null,
  updated_at timestamptz not null default now()
);

create table public.drimli_payout_commitments (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.drimli_payments(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  provider_id uuid not null references auth.users(id) on delete restrict,
  policy_snapshot text not null
    check (policy_snapshot in ('flexible', 'moderate', 'non_refundable')),
  amount_paid bigint not null check (amount_paid > 0),
  application_fee_amount bigint not null check (application_fee_amount >= 0),
  refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  payable_amount bigint not null check (payable_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  eligible_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'refund_processing', 'reserved', 'submitted', 'paid', 'cancelled', 'legacy')),
  payout_batch_id uuid null references public.drimli_payout_batches(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index drimli_payout_commitments_due_idx
  on public.drimli_payout_commitments(provider_id, currency, eligible_at)
  where status = 'pending';

create table public.drimli_payout_allocations (
  batch_id uuid not null references public.drimli_payout_batches(id) on delete restrict,
  commitment_id uuid not null unique references public.drimli_payout_commitments(id) on delete restrict,
  payment_id uuid not null unique references public.drimli_payments(id) on delete restrict,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (batch_id, commitment_id)
);

create table public.appointment_reschedule_audit (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  provider_id uuid not null references auth.users(id) on delete restrict,
  old_start_datetime timestamptz not null,
  old_end_datetime timestamptz not null,
  new_start_datetime timestamptz not null,
  new_end_datetime timestamptz not null,
  created_at timestamptz not null default now()
);

create or replace function public.begin_drimli_payment_refund(p_payment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare changed integer;
begin
  if not exists (select 1 from public.drimli_payout_commitments where payment_id = p_payment_id) then
    return true;
  end if;
  update public.drimli_payout_commitments
    set status = 'refund_processing', updated_at = now()
    where payment_id = p_payment_id and status = 'pending';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.release_drimli_payment_refund(p_payment_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.drimli_payout_commitments
    set status = 'pending', updated_at = now()
    where payment_id = p_payment_id and status = 'refund_processing';
$$;

create or replace function public.complete_drimli_payment_refund(
  p_payment_id uuid,
  p_refunded_amount bigint
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.drimli_payout_commitments
    set refunded_amount = greatest(refunded_amount, p_refunded_amount),
        payable_amount = greatest(0, amount_paid - application_fee_amount - greatest(refunded_amount, p_refunded_amount)),
        status = case
          when greatest(refunded_amount, p_refunded_amount) >= amount_paid then 'cancelled'
          else 'pending'
        end,
        updated_at = now()
    where payment_id = p_payment_id and status in ('refund_processing', 'pending');
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
      and a.status = 'confirmed'
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
    and a.status = 'confirmed'
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
    and a.status = 'confirmed'
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

create or replace function public.complete_drimli_payout_batch(
  p_batch_id uuid,
  p_stripe_payout_id text,
  p_stripe_status text,
  p_paid_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.drimli_payout_batches
    set status = case when p_stripe_status = 'paid' then 'paid' else 'submitted' end,
        stripe_payout_id = p_stripe_payout_id, stripe_status = p_stripe_status,
        paid_at = case when p_stripe_status = 'paid' then p_paid_at else null end,
        last_error = null, updated_at = now()
    where id = p_batch_id and status = 'processing';
  update public.drimli_payout_commitments
    set status = case when p_stripe_status = 'paid' then 'paid' else 'submitted' end, updated_at = now()
    where payout_batch_id = p_batch_id and status = 'reserved';
end;
$$;

create or replace function public.sync_drimli_payout_batch(
  p_batch_id uuid,
  p_stripe_status text,
  p_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.drimli_payout_batches
    set stripe_status = p_stripe_status,
        status = case when p_stripe_status = 'paid' then 'paid' when p_stripe_status in ('failed', 'canceled') then 'failed' else 'submitted' end,
        paid_at = case when p_stripe_status = 'paid' then p_updated_at else paid_at end,
        updated_at = now()
    where id = p_batch_id and status in ('submitted', 'paid');
  update public.drimli_payout_commitments
    set status = case when p_stripe_status = 'paid' then 'paid' when p_stripe_status in ('failed', 'canceled') then 'pending' else 'submitted' end,
        payout_batch_id = case when p_stripe_status in ('failed', 'canceled') then null else payout_batch_id end,
        updated_at = now()
    where payout_batch_id = p_batch_id and status in ('submitted', 'paid');
end;
$$;

create or replace function public.reschedule_paid_appointment(
  p_appointment_id uuid,
  p_provider_id uuid,
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
    set status = 'cancelled', payable_amount = 0, updated_at = now()
    where appointment_id = p_appointment_id and status = 'pending';
  return true;
end;
$$;

alter table public.drimli_payout_batches enable row level security;
alter table public.drimli_payout_commitments enable row level security;
alter table public.drimli_payout_allocations enable row level security;
alter table public.appointment_reschedule_audit enable row level security;

revoke all on public.drimli_payout_batches, public.drimli_payout_commitments,
  public.drimli_payout_allocations, public.appointment_reschedule_audit
  from public, anon, authenticated;
grant all on public.drimli_payout_batches, public.drimli_payout_commitments,
  public.drimli_payout_allocations, public.appointment_reschedule_audit
  to service_role;

revoke all on function public.begin_drimli_payment_refund(uuid),
  public.release_drimli_payment_refund(uuid),
  public.complete_drimli_payment_refund(uuid, bigint),
  public.claim_drimli_payout_batch(uuid, uuid, text, text, text, timestamptz),
  public.complete_drimli_payout_batch(uuid, text, text, timestamptz),
  public.sync_drimli_payout_batch(uuid, text, timestamptz),
  public.reschedule_paid_appointment(uuid, uuid, timestamptz, timestamptz, timestamptz),
  public.cancel_paid_appointment_without_refund(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_drimli_payment_refund(uuid),
  public.release_drimli_payment_refund(uuid),
  public.complete_drimli_payment_refund(uuid, bigint),
  public.claim_drimli_payout_batch(uuid, uuid, text, text, text, timestamptz),
  public.complete_drimli_payout_batch(uuid, text, text, timestamptz),
  public.sync_drimli_payout_batch(uuid, text, timestamptz),
  public.reschedule_paid_appointment(uuid, uuid, timestamptz, timestamptz, timestamptz),
  public.cancel_paid_appointment_without_refund(uuid, uuid)
  to service_role;

commit;
