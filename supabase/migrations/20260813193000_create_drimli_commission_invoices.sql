begin;

create table public.drimli_document_sequences (
  series text not null,
  document_year integer not null check (document_year between 2000 and 9999),
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (series, document_year)
);

create table public.drimli_commission_movements (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete restrict,
  payment_id uuid not null references public.drimli_payments(id) on delete restrict,
  refund_id uuid null references public.drimli_refunds(id) on delete restrict,
  movement_type text not null check (movement_type in ('collected', 'refunded')),
  amount bigint not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  effective_at timestamptz not null,
  stripe_reference text not null unique,
  invoice_id uuid null,
  credit_note_id uuid null,
  created_at timestamptz not null default now(),
  check (
    (movement_type = 'collected' and refund_id is null)
    or movement_type = 'refunded'
  ),
  check (not (invoice_id is not null and credit_note_id is not null))
);

create index drimli_commission_movements_closure_idx
  on public.drimli_commission_movements
  (provider_id, currency, movement_type, effective_at)
  where invoice_id is null and credit_note_id is null;
create index drimli_commission_movements_payment_idx
  on public.drimli_commission_movements(payment_id);
create unique index drimli_commission_movements_one_collection_per_payment
  on public.drimli_commission_movements(payment_id)
  where movement_type = 'collected';

create table public.drimli_commission_invoices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete restrict,
  invoice_number text not null unique,
  period_month date not null,
  issued_at timestamptz not null,
  status text not null default 'paid' check (status = 'paid'),
  issuer_snapshot jsonb not null,
  customer_snapshot jsonb not null,
  description text not null,
  total_excluding_tax bigint not null check (total_excluding_tax >= 0),
  vat_rate numeric(7, 4) not null check (vat_rate = 0.2),
  vat_amount bigint not null check (vat_amount >= 0),
  total_including_tax bigint not null check (total_including_tax > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  storage_bucket text null,
  file_path text null,
  generated_at timestamptz null,
  content_hash text null check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, period_month, currency),
  check ((storage_bucket is null) = (file_path is null))
);

create table public.drimli_commission_credit_notes (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete restrict,
  invoice_id uuid not null references public.drimli_commission_invoices(id) on delete restrict,
  movement_id uuid not null unique references public.drimli_commission_movements(id) on delete restrict,
  credit_note_number text not null unique,
  issued_at timestamptz not null,
  reason text not null,
  total_excluding_tax bigint not null check (total_excluding_tax > 0),
  vat_rate numeric(7, 4) not null check (vat_rate = 0.2),
  vat_amount bigint not null check (vat_amount >= 0),
  total_including_tax bigint not null check (total_including_tax > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  storage_bucket text null,
  file_path text null,
  generated_at timestamptz null,
  content_hash text null check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((storage_bucket is null) = (file_path is null))
);

alter table public.drimli_commission_movements
  add constraint drimli_commission_movements_invoice_fk
    foreign key (invoice_id) references public.drimli_commission_invoices(id) on delete restrict,
  add constraint drimli_commission_movements_credit_note_fk
    foreign key (credit_note_id) references public.drimli_commission_credit_notes(id) on delete restrict;

alter table public.drimli_monthly_invoice_periods
  drop constraint if exists drimli_monthly_invoice_periods_provider_id_period_month_key,
  add column if not exists total_refunded_application_fees bigint not null default 0,
  add column if not exists invoice_id uuid null references public.drimli_commission_invoices(id) on delete restrict;

create unique index if not exists drimli_monthly_invoice_periods_provider_month_currency_key
  on public.drimli_monthly_invoice_periods(provider_id, period_month, currency);

create or replace function public.next_drimli_document_number(
  p_series text,
  p_document_year integer
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_series text := upper(btrim(p_series));
  allocated_number bigint;
begin
  if normalized_series not in ('DRI', 'DRI-AV') then
    raise exception 'invalid DRIMLI document series';
  end if;
  if p_document_year not between 2000 and 9999 then
    raise exception 'invalid DRIMLI document year';
  end if;

  insert into public.drimli_document_sequences(series, document_year, last_number)
  values (normalized_series, p_document_year, 1)
  on conflict (series, document_year) do update
    set last_number = public.drimli_document_sequences.last_number + 1,
        updated_at = now()
  returning last_number into allocated_number;

  return normalized_series || '-' || p_document_year::text || '-'
    || lpad(allocated_number::text, 6, '0');
end;
$$;

create or replace function public.record_drimli_commission_movement(
  p_provider_id uuid,
  p_payment_id uuid,
  p_refund_id uuid,
  p_movement_type text,
  p_amount bigint,
  p_currency text,
  p_effective_at timestamptz,
  p_stripe_reference text
)
returns public.drimli_commission_movements
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare result public.drimli_commission_movements;
begin
  insert into public.drimli_commission_movements(
    provider_id, payment_id, refund_id, movement_type, amount,
    currency, effective_at, stripe_reference
  ) values (
    p_provider_id, p_payment_id, p_refund_id, p_movement_type, p_amount,
    upper(p_currency), p_effective_at, p_stripe_reference
  )
  on conflict do nothing
  returning * into result;

  if result.id is null then
    select * into result from public.drimli_commission_movements
      where stripe_reference = p_stripe_reference
         or (p_movement_type = 'collected'
             and payment_id = p_payment_id and movement_type = 'collected')
      order by (stripe_reference = p_stripe_reference) desc
      limit 1;
  end if;
  return result;
end;
$$;

create or replace function public.close_drimli_commission_month(
  p_provider_id uuid,
  p_period_month date,
  p_currency text,
  p_issued_at timestamptz,
  p_issuer_snapshot jsonb,
  p_customer_snapshot jsonb,
  p_description text
)
returns public.drimli_commission_invoices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result public.drimli_commission_invoices;
  period_end date := (p_period_month + interval '1 month')::date;
  collected_total bigint;
  refunded_total bigint;
  total_ttc bigint;
  total_ht bigint;
  invoice_number text;
begin
  select * into result from public.drimli_commission_invoices
    where provider_id = p_provider_id
      and period_month = p_period_month
      and currency = upper(p_currency)
    for update;
  if result.id is not null then return result; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_provider_id::text || ':' || p_period_month::text || ':' || upper(p_currency), 0
  ));

  select coalesce(sum(amount), 0) into collected_total
  from public.drimli_commission_movements
  where provider_id = p_provider_id
    and movement_type = 'collected'
    and currency = upper(p_currency)
    and effective_at >= p_period_month
    and effective_at < period_end
    and invoice_id is null and credit_note_id is null;

  select coalesce(sum(r.amount), 0) into refunded_total
  from public.drimli_commission_movements r
  where r.provider_id = p_provider_id
    and r.movement_type = 'refunded'
    and r.currency = upper(p_currency)
    and r.invoice_id is null and r.credit_note_id is null
    and exists (
      select 1 from public.drimli_commission_movements c
      where c.payment_id = r.payment_id
        and c.movement_type = 'collected'
        and c.effective_at >= p_period_month and c.effective_at < period_end
        and c.invoice_id is null and c.credit_note_id is null
    );

  total_ttc := collected_total - refunded_total;
  if total_ttc <= 0 then
    raise exception 'no positive retained commission for this period';
  end if;
  total_ht := round(total_ttc::numeric * 5 / 6);
  invoice_number := public.next_drimli_document_number(
    'DRI', extract(year from p_issued_at)::integer
  );

  insert into public.drimli_commission_invoices(
    provider_id, invoice_number, period_month, issued_at,
    issuer_snapshot, customer_snapshot, description,
    total_excluding_tax, vat_rate, vat_amount, total_including_tax, currency
  ) values (
    p_provider_id, invoice_number, p_period_month, p_issued_at,
    p_issuer_snapshot, p_customer_snapshot, p_description,
    total_ht, 0.2, total_ttc - total_ht, total_ttc, upper(p_currency)
  ) returning * into result;

  update public.drimli_commission_movements
  set invoice_id = result.id
  where provider_id = p_provider_id and currency = upper(p_currency)
    and invoice_id is null and credit_note_id is null
    and movement_type = 'collected'
    and effective_at >= p_period_month and effective_at < period_end;

  update public.drimli_commission_movements r
  set invoice_id = result.id
  where r.provider_id = p_provider_id and r.currency = upper(p_currency)
    and r.invoice_id is null and r.credit_note_id is null
    and r.movement_type = 'refunded'
    and exists (
      select 1 from public.drimli_commission_movements c
      where c.payment_id = r.payment_id
        and c.movement_type = 'collected' and c.invoice_id = result.id
    );

  insert into public.drimli_monthly_invoice_periods(
    provider_id, period_month, status, total_application_fees,
    total_refunded_application_fees, currency, invoice_id, updated_at
  ) values (
    p_provider_id, p_period_month, 'issued', collected_total,
    refunded_total, upper(p_currency), result.id, now()
  )
  on conflict (provider_id, period_month, currency) do update set
    status = 'issued', total_application_fees = excluded.total_application_fees,
    total_refunded_application_fees = excluded.total_refunded_application_fees,
    invoice_id = excluded.invoice_id, updated_at = now();

  return result;
end;
$$;

create or replace function public.create_drimli_commission_credit_note(
  p_movement_id uuid,
  p_issued_at timestamptz
)
returns public.drimli_commission_credit_notes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  movement public.drimli_commission_movements;
  original_invoice public.drimli_commission_invoices;
  result public.drimli_commission_credit_notes;
  total_ht bigint;
begin
  select * into movement from public.drimli_commission_movements
    where id = p_movement_id for update;
  if movement.movement_type <> 'refunded' then
    raise exception 'a refunded commission movement is required';
  end if;
  select * into result from public.drimli_commission_credit_notes
    where movement_id = p_movement_id;
  if result.id is not null then return result; end if;

  select i.* into original_invoice
  from public.drimli_commission_movements c
  join public.drimli_commission_invoices i on i.id = c.invoice_id
  where c.payment_id = movement.payment_id and c.movement_type = 'collected';
  if original_invoice.id is null then return null; end if;
  if movement.invoice_id is not null then return null; end if;

  total_ht := round(movement.amount::numeric * 5 / 6);
  insert into public.drimli_commission_credit_notes(
    provider_id, invoice_id, movement_id, credit_note_number, issued_at,
    reason, total_excluding_tax, vat_rate, vat_amount,
    total_including_tax, currency
  ) values (
    movement.provider_id, original_invoice.id, movement.id,
    public.next_drimli_document_number('DRI-AV', extract(year from p_issued_at)::integer),
    p_issued_at, 'Restitution de commission DRIMLI liée à un remboursement',
    total_ht, 0.2, movement.amount - total_ht, movement.amount, movement.currency
  ) returning * into result;

  update public.drimli_commission_movements
    set credit_note_id = result.id where id = movement.id;
  return result;
end;
$$;

create or replace function public.enforce_drimli_document_immutability()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception 'issued DRIMLI documents cannot be deleted'; end if;
  if (to_jsonb(new) - array['storage_bucket','file_path','generated_at','content_hash','updated_at'])
     is distinct from
     (to_jsonb(old) - array['storage_bucket','file_path','generated_at','content_hash','updated_at']) then
    raise exception 'issued DRIMLI document business data is immutable';
  end if;
  if (old.storage_bucket is not null and new.storage_bucket is distinct from old.storage_bucket)
     or (old.file_path is not null and new.file_path is distinct from old.file_path)
     or (old.generated_at is not null and new.generated_at is distinct from old.generated_at)
     or (old.content_hash is not null and new.content_hash is distinct from old.content_hash) then
    raise exception 'generated DRIMLI document metadata is immutable';
  end if;
  return new;
end;
$$;

create trigger drimli_commission_invoices_immutability
before update or delete on public.drimli_commission_invoices
for each row execute function public.enforce_drimli_document_immutability();
create trigger drimli_commission_credit_notes_immutability
before update or delete on public.drimli_commission_credit_notes
for each row execute function public.enforce_drimli_document_immutability();

alter table public.drimli_document_sequences enable row level security;
alter table public.drimli_commission_movements enable row level security;
alter table public.drimli_commission_invoices enable row level security;
alter table public.drimli_commission_credit_notes enable row level security;

revoke all on table public.drimli_document_sequences,
  public.drimli_commission_movements, public.drimli_commission_invoices,
  public.drimli_commission_credit_notes from public, anon, authenticated;
grant all on table public.drimli_document_sequences,
  public.drimli_commission_movements, public.drimli_commission_invoices,
  public.drimli_commission_credit_notes to service_role;
revoke all on function public.next_drimli_document_number(text, integer),
  public.record_drimli_commission_movement(uuid, uuid, uuid, text, bigint, text, timestamptz, text),
  public.close_drimli_commission_month(uuid, date, text, timestamptz, jsonb, jsonb, text),
  public.create_drimli_commission_credit_note(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.next_drimli_document_number(text, integer),
  public.record_drimli_commission_movement(uuid, uuid, uuid, text, bigint, text, timestamptz, text),
  public.close_drimli_commission_month(uuid, date, text, timestamptz, jsonb, jsonb, text),
  public.create_drimli_commission_credit_note(uuid, timestamptz)
  to service_role;

insert into public.drimli_commission_movements(
  provider_id, payment_id, movement_type, amount, currency,
  effective_at, stripe_reference
)
select provider_id, id, 'collected', application_fee_amount, currency,
  paid_at, 'payment_intent:' || stripe_payment_intent_id
from public.drimli_payments
where application_fee_amount > 0
on conflict do nothing;

commit;
