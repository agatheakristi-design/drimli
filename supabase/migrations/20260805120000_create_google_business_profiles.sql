begin;

create table public.google_business_profiles (
  provider_id uuid primary key references auth.users(id) on delete cascade,
  google_place_id text not null,
  google_business_name text not null,
  google_maps_url text not null,
  google_rating numeric(2, 1) null,
  google_reviews_count integer null,
  google_reviews_enabled boolean not null default false,
  google_reviews_last_synced_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint google_business_profiles_place_id_check
    check (google_place_id = btrim(google_place_id) and google_place_id <> ''),
  constraint google_business_profiles_name_check
    check (google_business_name = btrim(google_business_name) and google_business_name <> ''),
  constraint google_business_profiles_url_check
    check (google_maps_url = btrim(google_maps_url) and google_maps_url <> ''),
  constraint google_business_profiles_rating_check
    check (google_rating is null or google_rating between 0 and 5),
  constraint google_business_profiles_reviews_count_check
    check (google_reviews_count is null or google_reviews_count >= 0)
);

comment on table public.google_business_profiles is
  'A professional Google Place association. Place ID is the durable reference; name, rating, and review count are snapshots to refresh.';

alter table public.google_business_profiles enable row level security;

create policy "Professionals can read their own Google business profile"
on public.google_business_profiles
for select
to authenticated
using ((select auth.uid()) = provider_id);

create policy "Public can read enabled Google business profiles"
on public.google_business_profiles
for select
to anon, authenticated
using (google_reviews_enabled = true);

-- No insert, update, or delete policy is intentional: writes use server routes
-- authenticated with the service role only.

commit;
