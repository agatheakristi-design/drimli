begin;

/*
 * Client invoices are intentionally stored separately from the historical
 * public.invoices, public.patient_invoices, public.invoice_sequences, and
 * public.monthly_statements objects. This migration neither alters nor migrates
 * data from those objects. In particular, commission invoices remain outside
 * the scope of public.client_invoices.
 */

create table public.client_invoice_sequences (
  provider_id uuid not null references auth.users(id) on delete restrict,
  invoice_year integer not null,
  series text not null default 'FAC',
  last_number bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_invoice_sequences_pkey
    primary key (provider_id, invoice_year, series),
  constraint client_invoice_sequences_year_check
    check (invoice_year between 2000 and 9999),
  constraint client_invoice_sequences_series_check
    check (series ~ '^[A-Z][A-Z0-9_-]{0,19}$'),
  constraint client_invoice_sequences_last_number_check
    check (last_number >= 0)
);

comment on table public.client_invoice_sequences is
  'Server-only, atomic invoice counters scoped by professional, year, and series.';

create table public.client_invoices (
  id uuid primary key default gen_random_uuid(),

  provider_id uuid not null references auth.users(id) on delete restrict,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  product_id uuid null references public.products(id) on delete restrict,
  stripe_checkout_session_id text not null,
  stripe_payment_intent_id text null,
  invoice_number text not null,
  status text not null default 'draft',
  issued_at timestamptz not null,
  paid_at timestamptz null,
  service_date timestamptz not null,

  issuer_full_name text not null,
  issuer_business_name text null,
  issuer_profession text null,
  issuer_email text null,
  issuer_phone text null,
  issuer_address text not null,
  issuer_city text not null,
  issuer_postal_code text null,
  issuer_country text not null default 'FR',
  issuer_siret text not null,
  issuer_vat_number text null,
  issuer_legal_form text null,
  issuer_registration_details text null,

  customer_name text not null,
  customer_email text not null,
  customer_phone text null,
  customer_address text null,
  customer_city text null,
  customer_postal_code text null,
  customer_country text null,
  customer_business_name text null,
  customer_vat_number text null,

  service_title text not null,
  service_description text null,
  service_duration_minutes integer null,
  quantity integer not null default 1,
  unit_price_excluding_tax bigint not null,
  total_excluding_tax bigint not null,
  vat_rate numeric(7, 4) not null default 0,
  vat_amount bigint not null default 0,
  total_including_tax bigint not null,
  currency text not null default 'EUR',
  vat_regime text not null default 'franchise_base',
  vat_exemption_mention text null default 'TVA non applicable, art. 293 B du CGI',

  storage_bucket text null,
  file_path text null,
  generated_at timestamptz null,
  content_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_invoices_provider_number_key
    unique (provider_id, invoice_number),
  constraint client_invoices_checkout_session_key
    unique (stripe_checkout_session_id),
  constraint client_invoices_appointment_key
    unique (appointment_id),
  constraint client_invoices_status_check
    check (status in ('draft', 'issued', 'paid', 'cancelled')),
  constraint client_invoices_invoice_number_check
    check (invoice_number = btrim(invoice_number) and invoice_number <> ''),
  constraint client_invoices_checkout_session_check
    check (
      stripe_checkout_session_id = btrim(stripe_checkout_session_id)
      and stripe_checkout_session_id <> ''
    ),
  constraint client_invoices_payment_intent_check
    check (
      stripe_payment_intent_id is null
      or (
        stripe_payment_intent_id = btrim(stripe_payment_intent_id)
        and stripe_payment_intent_id <> ''
      )
    ),
  constraint client_invoices_service_duration_check
    check (service_duration_minutes is null or service_duration_minutes > 0),
  constraint client_invoices_quantity_check
    check (quantity > 0),
  constraint client_invoices_unit_price_check
    check (unit_price_excluding_tax >= 0),
  constraint client_invoices_total_excluding_tax_check
    check (total_excluding_tax >= 0),
  constraint client_invoices_vat_rate_check
    check (vat_rate >= 0 and vat_rate <= 1),
  constraint client_invoices_vat_amount_check
    check (vat_amount >= 0),
  constraint client_invoices_total_including_tax_check
    check (total_including_tax >= 0),
  constraint client_invoices_totals_check
    check (total_excluding_tax + vat_amount = total_including_tax),
  constraint client_invoices_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint client_invoices_paid_at_check
    check (status <> 'paid' or paid_at is not null),
  constraint client_invoices_franchise_base_check
    check (
      vat_regime <> 'franchise_base'
      or (
        vat_rate = 0
        and vat_amount = 0
        and nullif(btrim(vat_exemption_mention), '') is not null
      )
    ),
  constraint client_invoices_document_location_check
    check ((storage_bucket is null) = (file_path is null)),
  constraint client_invoices_storage_bucket_check
    check (storage_bucket is null or nullif(btrim(storage_bucket), '') is not null),
  constraint client_invoices_file_path_check
    check (file_path is null or nullif(btrim(file_path), '') is not null),
  constraint client_invoices_content_hash_check
    check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.client_invoices is
  'Immutable snapshots of invoices issued by professionals to their clients; created by trusted server code only.';
comment on column public.client_invoices.unit_price_excluding_tax is
  'Unit price excluding tax in the currency minor unit (for example euro cents).';
comment on column public.client_invoices.total_excluding_tax is
  'Total excluding tax in the currency minor unit.';
comment on column public.client_invoices.vat_rate is
  'VAT rate expressed as a fraction: 0.2000 means 20 percent.';
comment on column public.client_invoices.vat_amount is
  'VAT amount in the currency minor unit.';
comment on column public.client_invoices.total_including_tax is
  'Total including tax in the currency minor unit.';
comment on column public.client_invoices.content_hash is
  'Lowercase hexadecimal SHA-256 digest of the immutable generated document.';

create index client_invoices_provider_issued_at_idx
  on public.client_invoices (provider_id, issued_at desc);
create index client_invoices_payment_intent_idx
  on public.client_invoices (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create or replace function public.next_client_invoice_number(
  p_provider_id uuid,
  p_invoice_year integer default extract(year from current_date)::integer,
  p_series text default 'FAC'
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
  if p_provider_id is null then
    raise exception 'provider_id is required' using errcode = '22004';
  end if;

  if p_invoice_year not between 2000 and 9999 then
    raise exception 'invoice_year must be between 2000 and 9999'
      using errcode = '22023';
  end if;

  if normalized_series is null
     or normalized_series !~ '^[A-Z][A-Z0-9_-]{0,19}$' then
    raise exception 'invalid invoice series' using errcode = '22023';
  end if;

  insert into public.client_invoice_sequences (
    provider_id,
    invoice_year,
    series,
    last_number
  )
  values (
    p_provider_id,
    p_invoice_year,
    normalized_series,
    1
  )
  on conflict (provider_id, invoice_year, series)
  do update
    set last_number = public.client_invoice_sequences.last_number + 1,
        updated_at = now()
  returning last_number into allocated_number;

  if allocated_number > 999999 then
    raise exception 'invoice sequence exhausted for provider %, year %, series %',
      p_provider_id, p_invoice_year, normalized_series
      using errcode = '22003';
  end if;

  return normalized_series
    || '-'
    || p_invoice_year::text
    || '-'
    || lpad(allocated_number::text, 6, '0');
end;
$$;

comment on function public.next_client_invoice_number(uuid, integer, text) is
  'Atomically allocates the next invoice number for one professional, year, and series. Call in the same transaction that inserts the invoice.';

revoke all on function public.next_client_invoice_number(uuid, integer, text) from public;
revoke all on function public.next_client_invoice_number(uuid, integer, text) from anon;
revoke all on function public.next_client_invoice_number(uuid, integer, text) from authenticated;
grant execute on function public.next_client_invoice_number(uuid, integer, text) to service_role;

create or replace function public.set_client_invoice_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_client_invoice_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  old_business_data jsonb;
  new_business_data jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued, paid, or cancelled client invoices cannot be deleted'
        using errcode = '55000';
    end if;
    return old;
  end if;

  if old.status in ('issued', 'paid', 'cancelled') then
    old_business_data := to_jsonb(old) - array[
      'storage_bucket',
      'file_path',
      'generated_at',
      'content_hash',
      'updated_at'
    ];
    new_business_data := to_jsonb(new) - array[
      'storage_bucket',
      'file_path',
      'generated_at',
      'content_hash',
      'updated_at'
    ];

    if new_business_data is distinct from old_business_data then
      raise exception 'issued, paid, or cancelled client invoice business data is immutable'
        using errcode = '55000';
    end if;

    if (old.storage_bucket is not null and new.storage_bucket is distinct from old.storage_bucket)
       or (old.file_path is not null and new.file_path is distinct from old.file_path)
       or (old.generated_at is not null and new.generated_at is distinct from old.generated_at)
       or (old.content_hash is not null and new.content_hash is distinct from old.content_hash) then
      raise exception 'generated client invoice document metadata cannot be replaced or cleared'
        using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_client_invoice_immutability() is
  'Freezes all business data after draft and only permits one-time completion of private document metadata.';

create trigger client_invoices_immutability
before update or delete on public.client_invoices
for each row execute function public.enforce_client_invoice_immutability();

create trigger client_invoices_set_updated_at
before update on public.client_invoices
for each row execute function public.set_client_invoice_updated_at();

alter table public.client_invoices enable row level security;
alter table public.client_invoice_sequences enable row level security;

revoke all on table public.client_invoices from anon;
revoke all on table public.client_invoices from authenticated;
grant select on table public.client_invoices to authenticated;
grant all on table public.client_invoices to service_role;

revoke all on table public.client_invoice_sequences from anon;
revoke all on table public.client_invoice_sequences from authenticated;
grant all on table public.client_invoice_sequences to service_role;

create policy client_invoices_provider_select
on public.client_invoices
for select
to authenticated
using ((select auth.uid()) = provider_id);

/*
 * Future storage strategy (not implemented by this migration):
 * - keep the invoice bucket private;
 * - use non-guessable object paths;
 * - download through an authenticated server route for the professional, or
 *   through a dedicated, revocable client token;
 * - never expose invoice documents from a public bucket.
 */

commit;
