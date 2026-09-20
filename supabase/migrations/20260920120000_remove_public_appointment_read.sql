begin;

-- Client portals resolve an exact join_token on the trusted server using
-- service_role. A non-null token must never grant direct table access.
drop policy if exists "Public can read appointment by join token"
  on public.appointments;

commit;
