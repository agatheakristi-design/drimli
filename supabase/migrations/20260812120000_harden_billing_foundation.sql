begin;

alter table public.profiles
  add column if not exists postal_code text null,
  add column if not exists vat_regime text null,
  add column if not exists vat_rate numeric(7, 4) null;

alter table public.profiles
  drop constraint if exists profiles_vat_regime_check,
  add constraint profiles_vat_regime_check
    check (vat_regime is null or vat_regime in ('franchise_base', 'standard')),
  drop constraint if exists profiles_vat_rate_check,
  add constraint profiles_vat_rate_check
    check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 1));

update public.profiles set commission_rate = 5 where commission_rate is distinct from 5;
alter table public.profiles alter column commission_rate set default 5;
comment on column public.profiles.commission_rate is
  'Legacy display field. Checkout uses the server-side DRIMLI_COMMISSION_RATE constant.';

create table public.billing_checkout_snapshots (
  stripe_checkout_session_id text primary key,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  provider_id uuid not null references auth.users(id) on delete restrict,
  product_id uuid null references public.products(id) on delete restrict,
  amount_total bigint not null check (amount_total > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  application_fee_amount bigint not null check (application_fee_amount >= 0),
  issuer_full_name text not null,
  issuer_business_name text null,
  issuer_profession text null,
  issuer_email text null,
  issuer_phone text null,
  issuer_address text not null,
  issuer_city text not null,
  issuer_postal_code text null,
  issuer_country text not null,
  issuer_siret text not null,
  issuer_vat_number text null,
  vat_regime text not null check (vat_regime in ('franchise_base', 'standard')),
  vat_rate numeric(7, 4) not null check (vat_rate >= 0 and vat_rate <= 1),
  customer_name text not null,
  customer_email text not null,
  customer_phone text null,
  service_title text not null,
  service_description text null,
  service_duration_minutes integer null,
  created_at timestamptz not null default now(),
  unique (appointment_id)
);

create table public.drimli_payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  provider_id uuid not null references auth.users(id) on delete restrict,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text not null unique,
  amount_paid bigint not null check (amount_paid > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  application_fee_amount bigint not null check (application_fee_amount >= 0),
  refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  status text not null default 'paid' check (status in ('paid', 'partially_refunded', 'refunded')),
  paid_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (appointment_id)
);

create table public.drimli_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.drimli_payments(id) on delete restrict,
  stripe_refund_id text not null unique,
  amount bigint not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null,
  created_at timestamptz not null default now()
);

alter table public.stripe_webhook_events
  add column if not exists processing_status text not null default 'completed',
  add column if not exists processing_started_at timestamptz null,
  add column if not exists processed_at timestamptz null,
  add column if not exists last_error text null;

alter table public.stripe_webhook_events
  drop constraint if exists stripe_webhook_events_processing_status_check,
  add constraint stripe_webhook_events_processing_status_check
    check (processing_status in ('processing', 'completed', 'failed'));

create or replace function public.claim_stripe_webhook_event(p_id text, p_type text)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed boolean := false;
begin
  insert into public.stripe_webhook_events(id, type, processing_status, processing_started_at)
  values (p_id, p_type, 'processing', now())
  on conflict (id) do update set
    processing_status = 'processing', processing_started_at = now(), last_error = null
  where stripe_webhook_events.processing_status = 'failed'
     or (stripe_webhook_events.processing_status = 'processing'
         and stripe_webhook_events.processing_started_at < now() - interval '5 minutes')
  returning true into claimed;
  return coalesce(claimed, false);
end $$;

revoke all on table public.billing_checkout_snapshots, public.drimli_payments, public.drimli_refunds from public, anon, authenticated;
grant all on table public.billing_checkout_snapshots, public.drimli_payments, public.drimli_refunds to service_role;
alter table public.billing_checkout_snapshots enable row level security;
alter table public.drimli_payments enable row level security;
alter table public.drimli_refunds enable row level security;

commit;
