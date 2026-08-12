begin;

alter table public.billing_checkout_snapshots
  add column if not exists client_download_token_hash text null;

alter table public.client_invoices
  add column if not exists client_download_token_hash text null,
  add constraint client_invoices_download_token_hash_check
    check (
      client_download_token_hash is null
      or client_download_token_hash ~ '^[0-9a-f]{64}$'
    );

create index if not exists client_invoices_download_token_hash_idx
  on public.client_invoices (client_download_token_hash)
  where client_download_token_hash is not null;

create or replace function public.create_paid_client_invoice(p_invoice jsonb)
returns public.client_invoices
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  result public.client_invoices;
  invoice_year integer := extract(year from (p_invoice->>'issued_at')::timestamptz);
  invoice_number text;
begin
  select * into result from public.client_invoices
    where stripe_checkout_session_id = p_invoice->>'stripe_checkout_session_id';
  if found then return result; end if;

  invoice_number := public.next_client_invoice_number(
    (p_invoice->>'provider_id')::uuid, invoice_year, 'FAC'
  );

  insert into public.client_invoices (
    provider_id, appointment_id, product_id, stripe_checkout_session_id,
    stripe_payment_intent_id, invoice_number, status, issued_at, paid_at,
    service_date, issuer_full_name, issuer_business_name, issuer_profession,
    issuer_email, issuer_phone, issuer_address, issuer_city, issuer_postal_code,
    issuer_country, issuer_siret, issuer_vat_number, customer_name,
    customer_email, customer_phone, service_title, service_description,
    service_duration_minutes, unit_price_excluding_tax, total_excluding_tax,
    vat_rate, vat_amount, total_including_tax, currency, vat_regime,
    vat_exemption_mention, client_download_token_hash
  ) values (
    (p_invoice->>'provider_id')::uuid, (p_invoice->>'appointment_id')::uuid,
    nullif(p_invoice->>'product_id','')::uuid,
    p_invoice->>'stripe_checkout_session_id', p_invoice->>'stripe_payment_intent_id',
    invoice_number, 'paid', (p_invoice->>'issued_at')::timestamptz,
    (p_invoice->>'paid_at')::timestamptz, (p_invoice->>'service_date')::timestamptz,
    p_invoice->>'issuer_full_name', nullif(p_invoice->>'issuer_business_name',''),
    nullif(p_invoice->>'issuer_profession',''), nullif(p_invoice->>'issuer_email',''),
    nullif(p_invoice->>'issuer_phone',''), p_invoice->>'issuer_address',
    p_invoice->>'issuer_city', nullif(p_invoice->>'issuer_postal_code',''),
    p_invoice->>'issuer_country', p_invoice->>'issuer_siret',
    nullif(p_invoice->>'issuer_vat_number',''), p_invoice->>'customer_name',
    p_invoice->>'customer_email', nullif(p_invoice->>'customer_phone',''),
    p_invoice->>'service_title', nullif(p_invoice->>'service_description',''),
    nullif(p_invoice->>'service_duration_minutes','')::integer,
    (p_invoice->>'total_excluding_tax')::bigint,
    (p_invoice->>'total_excluding_tax')::bigint,
    (p_invoice->>'vat_rate')::numeric, (p_invoice->>'vat_amount')::bigint,
    (p_invoice->>'total_including_tax')::bigint, p_invoice->>'currency',
    p_invoice->>'vat_regime', nullif(p_invoice->>'vat_exemption_mention',''),
    nullif(p_invoice->>'client_download_token_hash','')
  ) returning * into result;
  return result;
end $$;

revoke all on function public.create_paid_client_invoice(jsonb) from public, anon, authenticated;
grant execute on function public.create_paid_client_invoice(jsonb) to service_role;

create table public.client_credit_notes (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete restrict,
  invoice_id uuid not null references public.client_invoices(id) on delete restrict,
  payment_id uuid not null references public.drimli_payments(id) on delete restrict,
  refund_id uuid not null references public.drimli_refunds(id) on delete restrict,
  stripe_refund_id text not null unique,
  credit_note_number text not null,
  issued_at timestamptz not null,
  refunded_at timestamptz not null,
  reason text null,
  issuer_snapshot jsonb not null,
  customer_snapshot jsonb not null,
  service_snapshot jsonb not null,
  total_excluding_tax bigint not null check (total_excluding_tax >= 0),
  vat_rate numeric(7, 4) not null check (vat_rate >= 0 and vat_rate <= 1),
  vat_amount bigint not null check (vat_amount >= 0),
  total_including_tax bigint not null check (total_including_tax > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  vat_exemption_mention text null,
  storage_bucket text null,
  file_path text null,
  generated_at timestamptz null,
  content_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, credit_note_number),
  constraint client_credit_notes_totals_check
    check (total_excluding_tax + vat_amount = total_including_tax),
  constraint client_credit_notes_document_location_check
    check ((storage_bucket is null) = (file_path is null)),
  constraint client_credit_notes_content_hash_check
    check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$')
);

alter table public.client_credit_notes enable row level security;
revoke all on table public.client_credit_notes from public, anon, authenticated;
grant select on table public.client_credit_notes to authenticated;
grant all on table public.client_credit_notes to service_role;

create policy client_credit_notes_provider_select
on public.client_credit_notes for select to authenticated
using ((select auth.uid()) = provider_id);

create or replace function public.enforce_client_credit_note_immutability()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'client credit notes cannot be deleted' using errcode = '55000';
  end if;
  if (to_jsonb(new) - array['storage_bucket','file_path','generated_at','content_hash','updated_at'])
     is distinct from
     (to_jsonb(old) - array['storage_bucket','file_path','generated_at','content_hash','updated_at']) then
    raise exception 'client credit note business data is immutable' using errcode = '55000';
  end if;
  if (old.storage_bucket is not null and new.storage_bucket is distinct from old.storage_bucket)
     or (old.file_path is not null and new.file_path is distinct from old.file_path)
     or (old.generated_at is not null and new.generated_at is distinct from old.generated_at)
     or (old.content_hash is not null and new.content_hash is distinct from old.content_hash) then
    raise exception 'generated credit note metadata cannot be replaced or cleared' using errcode = '55000';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger client_credit_notes_immutability
before update or delete on public.client_credit_notes
for each row execute function public.enforce_client_credit_note_immutability();

create or replace function public.create_client_credit_note(
  p_refund_id uuid,
  p_refunded_at timestamptz
) returns public.client_credit_notes
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  result public.client_credit_notes;
  refund_row public.drimli_refunds;
  payment_row public.drimli_payments;
  invoice_row public.client_invoices;
  ht bigint;
  vat bigint;
begin
  select * into result from public.client_credit_notes where refund_id = p_refund_id;
  if found then return result; end if;
  select * into refund_row from public.drimli_refunds where id = p_refund_id for update;
  select * into payment_row from public.drimli_payments where id = refund_row.payment_id;
  select * into invoice_row from public.client_invoices where appointment_id = payment_row.appointment_id;
  if refund_row.status <> 'succeeded' or invoice_row.id is null then
    raise exception 'successful refund and original invoice required';
  end if;
  ht := round(refund_row.amount::numeric * invoice_row.total_excluding_tax / invoice_row.total_including_tax);
  vat := refund_row.amount - ht;
  insert into public.client_credit_notes (
    provider_id, invoice_id, payment_id, refund_id, stripe_refund_id,
    credit_note_number, issued_at, refunded_at, issuer_snapshot,
    customer_snapshot, service_snapshot, total_excluding_tax, vat_rate,
    vat_amount, total_including_tax, currency, vat_exemption_mention
  ) values (
    payment_row.provider_id, invoice_row.id, payment_row.id, refund_row.id,
    refund_row.stripe_refund_id,
    public.next_client_invoice_number(payment_row.provider_id, extract(year from p_refunded_at)::integer, 'AVR'),
    p_refunded_at, p_refunded_at,
    jsonb_build_object('name',invoice_row.issuer_full_name,'businessName',invoice_row.issuer_business_name,'address',invoice_row.issuer_address,'postalCode',invoice_row.issuer_postal_code,'city',invoice_row.issuer_city,'country',invoice_row.issuer_country,'siret',invoice_row.issuer_siret,'vatNumber',invoice_row.issuer_vat_number),
    jsonb_build_object('name',invoice_row.customer_name,'email',invoice_row.customer_email,'address',invoice_row.customer_address,'postalCode',invoice_row.customer_postal_code,'city',invoice_row.customer_city,'country',invoice_row.customer_country),
    jsonb_build_object('title',invoice_row.service_title,'description',invoice_row.service_description,'durationMinutes',invoice_row.service_duration_minutes,'serviceDate',invoice_row.service_date,'originalInvoiceNumber',invoice_row.invoice_number),
    ht, invoice_row.vat_rate, vat, refund_row.amount, refund_row.currency,
    invoice_row.vat_exemption_mention
  ) returning * into result;
  return result;
end $$;

revoke all on function public.create_client_credit_note(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_client_credit_note(uuid, timestamptz) to service_role;

create table public.drimli_monthly_invoice_periods (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete restrict,
  period_month date not null,
  status text not null default 'pending_legal_configuration'
    check (status in ('pending_legal_configuration', 'ready', 'issued', 'cancelled')),
  total_client_payments bigint not null default 0,
  total_application_fees bigint not null default 0,
  total_refunds bigint not null default 0,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, period_month)
);

comment on table public.drimli_monthly_invoice_periods is
  'Non-fiscal preparation ledger for one future DRIMLI invoice per professional and month. It does not represent an issued invoice.';

alter table public.drimli_monthly_invoice_periods enable row level security;
revoke all on table public.drimli_monthly_invoice_periods from public, anon, authenticated;
grant select on table public.drimli_monthly_invoice_periods to authenticated;
grant all on table public.drimli_monthly_invoice_periods to service_role;
create policy drimli_monthly_invoice_periods_provider_select
on public.drimli_monthly_invoice_periods for select to authenticated
using ((select auth.uid()) = provider_id);

commit;
