begin;
-- Sources remain durable even when the worker, configuration or email API fails.
-- Reconciliation avoids coupling either user's write to email availability.
create table public.help_notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('request','reply')),
  source_id uuid not null,
  request_id uuid not null references public.help_requests(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending','processing','sent','attention')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  first_send_at timestamptz,
  payload jsonb,
  email_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique(kind, source_id)
);
alter table public.help_notifications enable row level security;
revoke all on public.help_notifications from anon, authenticated;
grant all on public.help_notifications to service_role;
create index help_notifications_pending on public.help_notifications(available_at) where state in ('pending','processing');

create function public.claim_help_notification() returns setof public.help_notifications
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.help_notifications(kind,source_id,request_id)
    select 'request',id,id from public.help_requests on conflict(kind,source_id) do nothing;
  insert into public.help_notifications(kind,source_id,request_id)
    select 'reply',id,request_id from public.help_replies on conflict(kind,source_id) do nothing;
  -- Never replay an ambiguous send beyond the provider's deduplication window.
  update public.help_notifications set state='attention', last_error='idempotency_window_requires_review', lease_token=null, lease_until=null
    where state in ('pending','processing') and first_send_at < now()-interval '23 hours'
      and (lease_until is null or lease_until < now());
  return query
    update public.help_notifications n set state='processing', attempts=n.attempts+1,
      lease_token=gen_random_uuid(), lease_until=now()+interval '5 minutes'
    where n.id=(select q.id from public.help_notifications q
      where (q.state='pending' and q.available_at<=now()) or (q.state='processing' and q.lease_until<now())
      order by q.available_at,q.id for update skip locked limit 1)
    returning n.*;
end $$;

-- Freeze the entire email body including recipient/from/link before the first send.
create function public.prepare_help_notification(p_id uuid,p_token uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 update public.help_notifications set payload=coalesce(payload,p_payload), first_send_at=coalesce(first_send_at,now())
 where id=p_id and lease_token=p_token and state='processing' and lease_until>now()
 returning payload into result;
 return result;
end $$;

create function public.finish_help_notification(p_id uuid,p_token uuid,p_email_id text,p_error text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 update public.help_notifications set
   state=case when p_email_id is not null then 'sent' else 'pending' end,
   email_id=p_email_id,last_error=p_error,
   available_at=now()+make_interval(secs=>least(3600,60*power(2,least(attempts,6)))::integer),
   lease_token=null,lease_until=null
 where id=p_id and lease_token=p_token and state='processing';
 return found;
end $$;
revoke all on function public.claim_help_notification(),public.prepare_help_notification(uuid,uuid,jsonb),public.finish_help_notification(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_help_notification(),public.prepare_help_notification(uuid,uuid,jsonb),public.finish_help_notification(uuid,uuid,text,text) to service_role;
commit;
