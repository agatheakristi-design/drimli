-- Read-only assertions for an explicitly authorized LOCAL database, AFTER the
-- migrations have separately been approved/applied there. Not executed by Node.
begin;
do $$
begin
  if has_column_privilege('anon','public.profiles','accountant_email','SELECT')
    or has_column_privilege('authenticated','public.profiles','accountant_email','SELECT') then
    raise exception 'private accountant address is exposed';
  end if;
  if not has_column_privilege('anon','public.profiles','full_name','SELECT')
    or not has_column_privilege('anon','public.profiles','published','SELECT')
    or not has_column_privilege('service_role','public.profiles','accountant_email','SELECT') then
    raise exception 'public profile/server access regression';
  end if;
  if has_function_privilege('anon','public.recover_accountant_deliveries()','EXECUTE')
    or has_function_privilege('authenticated','public.recover_accountant_deliveries()','EXECUTE') then
    raise exception 'recovery must remain service-only';
  end if;
end $$;
set local role anon;
select provider_id, full_name, published from public.profiles limit 1;
rollback;
