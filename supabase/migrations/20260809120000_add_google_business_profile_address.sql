begin;

alter table public.google_business_profiles
  add column google_business_address text null;

commit;
