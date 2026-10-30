-- LOCAL ONLY: requires separate approval before applying to any Supabase project.
-- New delivery journal; historical monthly_statements and billing data are untouched.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.accountant_monthly_deliveries (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete restrict,
  period_month date not null check (extract(day from period_month) = 1),
  recipient text not null check (btrim(recipient) <> ''),
  status text not null default 'pending' check (status in
    ('pending','preparing','sending','sent','failed','uncertain','empty','blocked','skipped','exhausted','purging','purged')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  submission_attempts integer not null default 0 check (submission_attempts between 0 and 10),
  lease_token uuid,
  lease_until timestamptz,
  archive_path text,
  archive_hash text check (archive_hash is null or archive_hash ~ '^[a-f0-9]{64}$'),
  archive_bytes integer check (archive_bytes between 0 and 4000000),
  archive_expires_at timestamptz not null default (now() + interval '30 days'),
  exported_count integer not null default 0,
  missing_documents jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_documents) = 'array'),
  link_token_hash text unique check (link_token_hash is null or link_token_hash ~ '^[a-f0-9]{64}$'),
  link_expires_at timestamptz,
  mail_payload jsonb,
  send_started_at timestamptz,
  resend_id text,
  sent_at timestamptz,
  last_error text,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, period_month),
  check ((lease_token is null) = (lease_until is null)),
  check (archive_path is null or archive_path like
    'providers/' || provider_id::text || '/accountant-monthly/' || id::text || '/%.zip')
);
create index accountant_deliveries_work_idx on public.accountant_monthly_deliveries(status, created_at);
alter table public.accountant_monthly_deliveries enable row level security;
revoke all on public.accountant_monthly_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.accountant_monthly_deliveries to service_role;

create function public.queue_accountant_month(p_period date) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
  if extract(day from p_period) <> 1 or p_period >= date_trunc('month', now() at time zone 'Europe/Paris')::date then
    raise exception 'invalid accounting period';
  end if;
  insert into public.accountant_monthly_deliveries(provider_id, period_month, recipient)
  select p.provider_id, p_period, btrim(p.accountant_email) from public.profiles p
  where nullif(btrim(p.accountant_email), '') is not null and (
    exists(select 1 from public.client_invoices i where i.provider_id = p.provider_id
      and i.issued_at >= (p_period::timestamp at time zone 'Europe/Paris')
      and i.issued_at < ((p_period + interval '1 month')::timestamp at time zone 'Europe/Paris'))
    or exists(select 1 from public.client_credit_notes c where c.provider_id = p.provider_id
      and c.issued_at >= (p_period::timestamp at time zone 'Europe/Paris')
      and c.issued_at < ((p_period + interval '1 month')::timestamp at time zone 'Europe/Paris'))
  ) on conflict (provider_id, period_month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Durable recovery: only expired/no leases are changed, never active workers.
-- A possibly submitted payload is NEVER returned to the automatic send queue.
create function public.recover_accountant_deliveries() returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ready integer;
begin
  with abandoned as (
    select id from public.accountant_monthly_deliveries
    where lease_until < clock_timestamp() and status in ('preparing','sending')
    order by created_at, id for update skip locked
  )
  update public.accountant_monthly_deliveries d set
    status = case when d.mail_payload is not null or d.status = 'sending' then 'uncertain'
      when d.attempts >= 10 then 'exhausted' else 'pending' end,
    last_error = case when d.mail_payload is not null or d.status = 'sending' then 'expired_send_lease'
      when d.attempts >= 10 then 'attempts_exhausted' else 'interrupted_preparation' end,
    lease_token = null, lease_until = null, updated_at = clock_timestamp(),
    events = events || jsonb_build_array(jsonb_build_object('event','lease_recovered','previous_status',d.status,'at',clock_timestamp()))
    from abandoned a where d.id = a.id;
  with exhausted as (
    select id from public.accountant_monthly_deliveries
    where attempts >= 10 and mail_payload is null and lease_until is null
      and status in ('pending','failed','blocked','empty','skipped')
    order by created_at, id for update skip locked
  )
  update public.accountant_monthly_deliveries d set status = 'exhausted', last_error = 'attempts_exhausted',
    updated_at = clock_timestamp(), events = events || jsonb_build_array(jsonb_build_object('event','attempts_exhausted','at',clock_timestamp()))
    from exhausted e where d.id = e.id;
  select count(*) into ready from public.accountant_monthly_deliveries
    where status = 'pending' and attempts < 10;
  return ready;
end $$;

create function public.claim_accountant_delivery(p_id uuid default null, p_retry boolean default false)
returns public.accountant_monthly_deliveries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d public.accountant_monthly_deliveries; current_recipient text;
begin
  if p_retry and p_id is null then raise exception 'retry requires an explicit delivery id'; end if;
  perform public.recover_accountant_deliveries();
  select * into d from public.accountant_monthly_deliveries
  where (p_id is null or id = p_id) and attempts < 10 and (
    (not p_retry and (status = 'pending' or (status = 'preparing' and mail_payload is null and lease_until < clock_timestamp())))
    or (p_retry and (status in ('pending','failed','blocked','empty','skipped')
      or (status = 'preparing' and mail_payload is null and lease_until < clock_timestamp())
      or (status = 'uncertain' and mail_payload is not null and send_started_at > clock_timestamp() - interval '23 hours')))
  ) order by created_at, id for update skip locked limit 1;
  if not found then return null; end if;
  select btrim(accountant_email) into current_recipient from public.profiles where provider_id = d.provider_id;
  if coalesce(current_recipient, '') = '' or (d.mail_payload is not null and current_recipient <> d.recipient) then
    update public.accountant_monthly_deliveries set status = case when mail_payload is null then 'skipped' else 'uncertain' end,
      last_error = 'accountant_address_changed_or_removed', lease_token = null, lease_until = null,
      updated_at = clock_timestamp() where id = d.id;
    return null;
  end if;
  update public.accountant_monthly_deliveries set status = 'preparing', attempts = attempts + 1,
    recipient = case when mail_payload is null then current_recipient else recipient end,
    lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '2 minutes', updated_at = clock_timestamp(),
    events = events || jsonb_build_array(jsonb_build_object('event','claimed','at',clock_timestamp()))
    where id = d.id returning * into d;
  return d;
end $$;

create function public.transition_accountant_delivery(p_id uuid, p_lease uuid, p_action text, p_data jsonb default '{}'::jsonb)
returns public.accountant_monthly_deliveries
language plpgsql security definer set search_path = pg_catalog, public as $$
declare d public.accountant_monthly_deliveries; current_recipient text;
begin
  select * into d from public.accountant_monthly_deliveries where id = p_id for update;
  if not found or d.lease_token is distinct from p_lease or d.lease_until <= clock_timestamp()
    or d.status not in ('preparing','sending') then raise exception 'delivery lease lost'; end if;
  if p_action = 'prepared' then
    if d.status <> 'preparing' or d.mail_payload is not null then raise exception 'cannot replace submitted archive'; end if;
    update public.accountant_monthly_deliveries set
      archive_path = p_data->>'archive_path', archive_hash = p_data->>'archive_hash',
      archive_bytes = (p_data->>'archive_bytes')::integer, archive_expires_at = clock_timestamp() + interval '30 days',
      exported_count = (p_data->>'exported_count')::integer, missing_documents = p_data->'missing_documents',
      link_token_hash = p_data->>'link_token_hash', link_expires_at = clock_timestamp() + interval '7 days'
      where id = p_id;
  elsif p_action = 'sending' then
    select btrim(accountant_email) into current_recipient from public.profiles where provider_id = d.provider_id;
    if current_recipient is distinct from d.recipient or coalesce(current_recipient, '') = '' then
      raise exception 'accountant address changed';
    end if;
    if d.archive_path is null or d.link_token_hash is null or d.archive_expires_at <= clock_timestamp()
      or d.link_expires_at <= clock_timestamp() then raise exception 'archive unavailable'; end if;
    if p_data->'payload'->>'to' is distinct from d.recipient or (d.mail_payload is not null and d.mail_payload <> p_data->'payload') then
      raise exception 'mail payload mismatch';
    end if;
    if d.send_started_at is not null and d.send_started_at <= clock_timestamp() - interval '23 hours' then
      raise exception 'send reconciliation required';
    end if;
    update public.accountant_monthly_deliveries set status = 'sending', mail_payload = p_data->'payload',
      submission_attempts = submission_attempts + 1,
      send_started_at = coalesce(send_started_at, clock_timestamp()), lease_until = clock_timestamp() + interval '2 minutes'
      where id = p_id;
  elsif p_action = 'sent' then
    if d.status <> 'sending' or nullif(p_data->>'resend_id','') is null then raise exception 'missing accepted email'; end if;
    update public.accountant_monthly_deliveries set status = 'sent', resend_id = p_data->>'resend_id',
      sent_at = clock_timestamp(), lease_token = null, lease_until = null, last_error = null where id = p_id;
  elsif p_action in ('failed','uncertain','empty','blocked','skipped') then
    -- Clearing a submitted payload is allowed only after an explicit Resend rejection.
    if d.status = 'sending' and p_action not in ('failed','uncertain') then raise exception 'submitted email requires reconciliation'; end if;
    if p_action = 'failed' and d.mail_payload is not null and (d.status <> 'sending' or d.submission_attempts > 1) then
      raise exception 'previous submission remains uncertain';
    end if;
    update public.accountant_monthly_deliveries set status = case when p_action <> 'uncertain' and attempts >= 10 and (mail_payload is null or p_action = 'failed') then 'exhausted' else p_action end, last_error = p_data->>'error',
      mail_payload = case when p_action = 'failed' then null else mail_payload end,
      send_started_at = case when p_action = 'failed' then null else send_started_at end,
      submission_attempts = case when p_action = 'failed' then 0 else submission_attempts end,
      missing_documents = coalesce(p_data->'missing_documents', missing_documents),
      lease_token = null, lease_until = null where id = p_id;
  else raise exception 'invalid transition'; end if;
  update public.accountant_monthly_deliveries set updated_at = clock_timestamp(),
    events = events || jsonb_build_array(jsonb_build_object('event',p_action,'at',clock_timestamp(),'error',p_data->>'error'))
    where id = p_id returning * into d;
  return d;
end $$;

create function public.renew_accountant_delivery_link(p_id uuid, p_provider uuid, p_hash text)
returns timestamptz language plpgsql security definer set search_path = pg_catalog, public as $$
declare d public.accountant_monthly_deliveries; current_recipient text; expiry timestamptz;
begin
  select * into d from public.accountant_monthly_deliveries where id = p_id and provider_id = p_provider for update;
  if not found or d.status <> 'sent' or d.archive_path is null or d.archive_expires_at <= clock_timestamp() then
    raise exception 'archive unavailable'; end if;
  select btrim(accountant_email) into current_recipient from public.profiles where provider_id = p_provider;
  if current_recipient is distinct from d.recipient or coalesce(current_recipient, '') = '' then raise exception 'accountant address changed'; end if;
  expiry := least(clock_timestamp() + interval '7 days', d.archive_expires_at);
  update public.accountant_monthly_deliveries set link_token_hash = p_hash, link_expires_at = expiry,
    updated_at = clock_timestamp(), events = events || jsonb_build_array(jsonb_build_object('event','link_renewed','at',clock_timestamp())) where id = p_id;
  return expiry;
end $$;

create function public.reconcile_accountant_delivery(p_id uuid, p_resend_id text) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if nullif(p_resend_id, '') is null then raise exception 'accepted email id required'; end if;
  update public.accountant_monthly_deliveries set status = 'sent', resend_id = p_resend_id,
    sent_at = coalesce(sent_at, clock_timestamp()), lease_token = null, lease_until = null, last_error = null,
    updated_at = clock_timestamp(), events = events || jsonb_build_array(jsonb_build_object('event','reconciled_sent','at',clock_timestamp()))
    where id = p_id and mail_payload is not null and (status = 'uncertain'
      or (status in ('sending','preparing') and lease_until < clock_timestamp())
      or (status = 'sent' and resend_id = p_resend_id));
  return found;
end $$;

create function public.claim_accountant_archive_cleanup(p_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  -- Row update serializes cleanup against claims/transitions. Expired leases
  -- cannot transition afterwards; only this delivery's technical prefix is purged.
  update public.accountant_monthly_deliveries set status = 'purging',
    lease_token = null, lease_until = null, updated_at = clock_timestamp(),
    events = events || jsonb_build_array(jsonb_build_object('event','cleanup_claimed','previous_status',status,'at',clock_timestamp()))
    where id = p_id and archive_expires_at <= clock_timestamp() and status <> 'purged'
      and (status not in ('preparing','sending') or lease_until < clock_timestamp());
  return found;
end $$;

create function public.purge_accountant_delivery_archive(p_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.accountant_monthly_deliveries set status = 'purged', archive_path = null, archive_hash = null,
    link_token_hash = null, link_expires_at = null, mail_payload = null, updated_at = clock_timestamp(),
    events = events || jsonb_build_array(jsonb_build_object('event','archive_purged','at',clock_timestamp()))
    where id = p_id and archive_expires_at <= clock_timestamp() and status = 'purging';
  return found;
end $$;

revoke all on function public.recover_accountant_deliveries(), public.queue_accountant_month(date), public.claim_accountant_delivery(uuid,boolean),
  public.transition_accountant_delivery(uuid,uuid,text,jsonb), public.renew_accountant_delivery_link(uuid,uuid,text),
  public.reconcile_accountant_delivery(uuid,text), public.claim_accountant_archive_cleanup(uuid), public.purge_accountant_delivery_archive(uuid) from public, anon, authenticated;
grant execute on function public.recover_accountant_deliveries(), public.queue_accountant_month(date), public.claim_accountant_delivery(uuid,boolean),
  public.transition_accountant_delivery(uuid,uuid,text,jsonb), public.renew_accountant_delivery_link(uuid,uuid,text),
  public.reconcile_accountant_delivery(uuid,text), public.claim_accountant_archive_cleanup(uuid), public.purge_accountant_delivery_archive(uuid) to service_role;
commit;
