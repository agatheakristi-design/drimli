begin;

-- Historical schema baseline reconstructed from Production metadata only.
-- This migration intentionally contains no Production business data.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create table public.profiles (
  id uuid default gen_random_uuid(),
  provider_id uuid,
  full_name text,
  email text,
  phone text,
  business_name text,
  avatar_url text,
  calendly_url text default '',
  pricing numeric,
  currency text default 'EUR',
  commission_rate numeric default 10,
  created_at timestamptz not null default '2025-12-14 07:38:30.202916+00',
  updated_at timestamptz default '2025-12-14 07:38:30.202916+00',
  profession text,
  city text,
  description text,
  logo_url text,
  slug text,
  published boolean not null default false,
  booking_url text,
  contact_phone text,
  contact_whatsapp text,
  contact_email text,
  stripe_account_id text,
  drimpay_status text default '''inactive''',
  availability jsonb,
  accountant_email text,
  timezone text,
  stripe_connect_account_id text,
  legacy_dropped_column text,
  address text,
  country text,
  siret text,
  first_name text,
  last_name text,
  vat_number text,
  consultation_type text,
  constraint profiles_pkey primary key (id),
  constraint profiles_provider_id_unique unique (provider_id)
);

alter table public.profiles drop column legacy_dropped_column;

create unique index profiles_slug_unique on public.profiles (slug);

create table public.products (
  id uuid default gen_random_uuid(),
  provider_id uuid,
  created_at timestamptz not null default now(),
  title text,
  description text,
  duration_minutes integer,
  price_cents integer,
  active boolean not null default true,
  consultation_type text,
  stripe_price_id text,
  constraint "Products_pkey" primary key (id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider_id uuid,
  product_id uuid default gen_random_uuid(),
  client_name text,
  client_email text,
  client_phone text,
  start_datetime timestamptz,
  end_datetime timestamptz,
  status text default '''pending''',
  stripe_payment_intent_id text,
  access_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  video_provider text not null default 'none',
  video_join_url text,
  video_room_id text,
  join_token text,
  confirmation_email_sent_at timestamptz,
  constraint appointments_video_provider_check
    check (video_provider in ('none', 'google_meet', 'whatsapp', 'jitsi')),
  constraint no_overlap_same_provider
    exclude using gist (
      provider_id with =,
      tstzrange(start_datetime, end_datetime, '[)') with &&
    ) where (status in ('pending', 'confirmed'))
);

create unique index appointments_access_token_unique
  on public.appointments (access_token);
create unique index appointments_join_token_uniq
  on public.appointments (join_token);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null,
  service_id uuid not null,
  customer_email text,
  scheduled_at timestamptz not null,
  status text not null default 'pending',
  stripe_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now()
);

create index bookings_provider_id_idx on public.bookings (provider_id);
create index bookings_scheduled_at_idx on public.bookings (scheduled_at);
create index bookings_service_id_idx on public.bookings (service_id);

create table public.configurations (
  provider_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary_color text default '#118ADB',
  secondary_color text default '#FFFFFF',
  accent_color text default '#000000',
  whatsapp_number text default '',
  calendly_url text,
  booking_slot_duration integer default 60,
  weekly_schedule jsonb default '{}'::jsonb,
  allow_whatsapp_video boolean default true,
  payment_required_before_booking boolean default true,
  send_after_booking_message boolean default true,
  updated_at timestamptz default now(),
  timezone text default 'Europe/Paris'
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  account_email text,
  access_token text,
  refresh_token text,
  token_type text,
  scope text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_provider_unique unique (provider_id, provider),
  constraint integrations_provider_check
    check (provider in ('google', 'zoom', 'teams', 'outlook'))
);

create index integrations_provider_id_idx on public.integrations (provider_id);

create table public.provider_blocks (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles(provider_id) on delete cascade,
  start_datetime timestamptz not null,
  end_datetime timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint provider_blocks_valid_range check (end_datetime > start_datetime)
);

create index provider_blocks_provider_start_idx
  on public.provider_blocks (provider_id, start_datetime);

create table public.invoice_sequences (
  year integer primary key,
  last_number integer not null
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null,
  appointment_id uuid,
  type text not null,
  status text not null default 'ISSUED',
  invoice_number text not null,
  currency text not null default 'eur',
  total_ht integer not null,
  total_vat integer not null,
  total_ttc integer not null,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  issued_at timestamptz not null default now()
);

create unique index invoices_unique_number on public.invoices (invoice_number);
create unique index invoices_unique_session
  on public.invoices (stripe_checkout_session_id);

create table public.monthly_statements (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null,
  statement_month text not null,
  zip_bucket text not null default 'invoices',
  zip_path text not null,
  statement_pdf_bucket text not null default 'invoices',
  statement_pdf_path text not null,
  sent_to text,
  sent_at timestamptz,
  status text not null default 'generated',
  error_message text,
  created_at timestamptz not null default now()
);

create index monthly_statements_provider
  on public.monthly_statements (provider_id);
create unique index monthly_statements_unique_provider_month
  on public.monthly_statements (provider_id, statement_month);

create table public.patient_invoices (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null,
  appointment_id uuid not null,
  stripe_checkout_session_id text not null,
  period_month text not null,
  bucket text not null default 'invoices',
  file_path text not null,
  created_at timestamptz not null default now()
);

create index patient_invoices_provider_month
  on public.patient_invoices (provider_id, period_month);
create unique index patient_invoices_unique_session
  on public.patient_invoices (stripe_checkout_session_id);

create table public.stripe_webhook_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);

alter table public.appointments enable row level security;
alter table public.bookings enable row level security;
alter table public.configurations enable row level security;
alter table public.integrations enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.provider_blocks enable row level security;

create policy "Providers can read their appointments"
  on public.appointments for select to authenticated
  using (provider_id = auth.uid());
create policy "Public can insert pending appointments (MVP)"
  on public.appointments for insert to anon, authenticated
  with check (
    status = 'pending' and provider_id is not null and product_id is not null
    and start_datetime is not null and end_datetime is not null
  );
create policy "Public can read appointment by join token"
  on public.appointments for select to anon, authenticated
  using (join_token is not null);
create policy "providers can delete their appointments"
  on public.appointments for delete to authenticated
  using (provider_id = auth.uid());
create policy "providers can insert their appointments"
  on public.appointments for insert to authenticated
  with check (provider_id = auth.uid());
create policy "providers can update their appointments"
  on public.appointments for update to authenticated
  using (provider_id = auth.uid()) with check (provider_id = auth.uid());
create policy "providers can view their appointments"
  on public.appointments for select to authenticated
  using (provider_id = auth.uid());

create policy "anon can create booking"
  on public.bookings for insert to public with check (true);
create policy "provider can read own bookings"
  on public.bookings for select to public using (auth.uid() = provider_id);

create policy "Providers can insert their config"
  on public.configurations for insert to authenticated
  with check (auth.uid() = provider_id);
create policy "Providers can read their config"
  on public.configurations for select to authenticated
  using (auth.uid() = provider_id);
create policy "Providers can update their config"
  on public.configurations for update to authenticated
  using (auth.uid() = provider_id) with check (auth.uid() = provider_id);

create policy "Products: public read active for published providers"
  on public.products for select to public
  using (
    active = true and exists (
      select 1 from public.profiles p
      where p.provider_id = products.provider_id and p.published = true
    )
  );
create policy "Products: users can delete their products"
  on public.products for delete to authenticated using (auth.uid() = provider_id);
create policy "Products: users can insert their products"
  on public.products for insert to authenticated with check (auth.uid() = provider_id);
create policy "Products: users can read their products"
  on public.products for select to authenticated using (auth.uid() = provider_id);
create policy "Products: users can update their products"
  on public.products for update to authenticated
  using (auth.uid() = provider_id) with check (auth.uid() = provider_id);
create policy "Public can read active products"
  on public.products for select to public using (active is true);
create policy "Users can select their own products"
  on public.products for select to authenticated using (auth.uid() = provider_id);

create policy "Profiles: public read published"
  on public.profiles for select to public using (published = true);
create policy "Profiles: users can insert their profile"
  on public.profiles for insert to authenticated with check (auth.uid() = provider_id);
create policy "Profiles: users can read their profile"
  on public.profiles for select to authenticated using (provider_id = auth.uid());
create policy "Profiles: users can update their profile"
  on public.profiles for update to authenticated
  using (provider_id = auth.uid()) with check (provider_id = auth.uid());

create policy provider_blocks_delete_own
  on public.provider_blocks for delete to public using (auth.uid() = provider_id);
create policy provider_blocks_insert_own
  on public.provider_blocks for insert to public with check (auth.uid() = provider_id);
create policy provider_blocks_select_own
  on public.provider_blocks for select to public using (auth.uid() = provider_id);

grant all on table public.appointments, public.bookings, public.configurations,
  public.integrations, public.products, public.profiles, public.provider_blocks
  to anon, authenticated, service_role;
grant all on table public.invoice_sequences, public.invoices,
  public.monthly_statements, public.patient_invoices, public.stripe_webhook_events
  to service_role;

insert into storage.buckets (id, name, public)
values
  ('drimli-public', 'drimli-public', true),
  ('invoices', 'invoices', false)
on conflict (id) do update set name = excluded.name, public = excluded.public;

update storage.buckets
set file_size_limit = 5242880
where id = 'drimli-public';

create policy "Delete uniquement si connecté 1sbe6dj_0"
  on storage.objects for delete to authenticated
  using (bucket_id = 'drimli-public');
create policy "Delete uniquement si connecté 1sbe6dj_1"
  on storage.objects for select to authenticated
  using (bucket_id = 'drimli-public');
create policy "Lecture publique sur le bucket 1sbe6dj_0"
  on storage.objects for select to public
  using (bucket_id = 'drimli-public');
create policy "Update uniquement si connecté 1sbe6dj_0"
  on storage.objects for update to authenticated
  using (bucket_id = 'drimli-public');
create policy "Update uniquement si connecté 1sbe6dj_1"
  on storage.objects for select to authenticated
  using (bucket_id = 'drimli-public');
create policy "Upload uniquement si connecté 1sbe6dj_0"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'drimli-public');

commit;
