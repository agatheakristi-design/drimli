-- LOCAL ONLY. Separate authorization is required before applying to Supabase.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- RLS still controls which profile rows are visible. Table SELECT would override
-- a column revocation, so replace it with SELECT on every existing OTHER column.
-- Private accountant access remains through authenticated server APIs/service_role.
revoke select on public.profiles from public, anon, authenticated;
revoke select (accountant_email) on public.profiles from public, anon, authenticated;
do $$
declare readable_columns text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into readable_columns
  from pg_catalog.pg_attribute
  where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
    and attname <> 'accountant_email';
  execute format('grant select (%s) on public.profiles to anon, authenticated', readable_columns);
end $$;
grant select (accountant_email) on public.profiles to service_role;
do $$
begin
  if has_column_privilege('anon', 'public.profiles', 'accountant_email', 'SELECT')
    or has_column_privilege('authenticated', 'public.profiles', 'accountant_email', 'SELECT') then
    raise exception 'accountant_email still readable through inherited privileges';
  end if;
end $$;
-- Existing RLS, writes, profile data and public-page column selections are unchanged.
commit;
