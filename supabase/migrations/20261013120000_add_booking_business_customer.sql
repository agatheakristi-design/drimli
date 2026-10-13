begin;

-- Nullable additions preserve all historical rows and existing B2C snapshots.
alter table public.appointments
  add column customer_billing jsonb null
  check (customer_billing is null or jsonb_typeof(customer_billing) = 'object');

alter table public.billing_checkout_snapshots
  add column customer_type text null check (customer_type in ('individual', 'business')),
  add column customer_business_name text null,
  add column customer_siren text null,
  add column customer_siret text null,
  add column customer_address text null,
  add column customer_postal_code text null,
  add column customer_city text null,
  add column customer_country text null,
  add column customer_vat_number text null;

alter table public.client_invoices
  add column customer_type text null check (customer_type in ('individual', 'business')),
  add column customer_siren text null,
  add column customer_siret text null;

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
    customer_email, customer_phone, customer_type, customer_business_name,
    customer_siren, customer_siret, customer_address, customer_postal_code,
    customer_city, customer_country, customer_vat_number, service_title, service_description,
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
    nullif(p_invoice->>'customer_type',''), nullif(p_invoice->>'customer_business_name',''),
    nullif(p_invoice->>'customer_siren',''), nullif(p_invoice->>'customer_siret',''),
    nullif(p_invoice->>'customer_address',''), nullif(p_invoice->>'customer_postal_code',''),
    nullif(p_invoice->>'customer_city',''), nullif(p_invoice->>'customer_country',''),
    nullif(p_invoice->>'customer_vat_number',''),
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

commit;
