-- Run only against a disposable LOCAL fixture containing minimal auth/profiles/documents.
-- Never run this test on DEV or Production.
begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
insert into public.profiles(provider_id, accountant_email) values
 ('11111111-1111-4111-8111-111111111111','alice-compta@example.test'),
 ('22222222-2222-4222-8222-222222222222','   '),
 ('33333333-3333-4333-8333-333333333333','charlie-compta@example.test');
insert into public.client_invoices(provider_id,issued_at) values
 ('11111111-1111-4111-8111-111111111111','2026-08-31T22:00:00Z'), -- September in Paris
 ('22222222-2222-4222-8222-222222222222','2026-09-10T12:00:00Z');
select public.queue_accountant_month('2026-09-01');
do $$ begin
 if (select count(*) from public.accountant_monthly_deliveries) <> 1 then raise exception 'empty address/no documents selection failed'; end if;
 if (select count(*) from public.client_invoices) <> 2 then raise exception 'source modified'; end if;
end $$;
create temp table claimed as select * from public.claim_accountant_delivery();
do $$ begin
 if (select status from claimed) <> 'preparing' then raise exception 'claim failed'; end if;
 if (public.claim_accountant_delivery()).id is not null then raise exception 'simultaneous claim allowed'; end if;
 begin
  perform public.transition_accountant_delivery((select id from claimed),gen_random_uuid(),'failed');
  raise exception 'stale lease accepted';
 exception when raise_exception then if sqlerrm <> 'delivery lease lost' then raise; end if; end;
end $$;
select public.transition_accountant_delivery(id,lease_token,'prepared',jsonb_build_object(
 'archive_path','providers/'||provider_id||'/accountant-monthly/'||id||'/'||lease_token||'.zip',
 'archive_hash',repeat('a',64),'archive_bytes',100,'exported_count',1,'missing_documents','[]'::jsonb,'link_token_hash',repeat('b',64))) from claimed;
select public.transition_accountant_delivery(id,lease_token,'sending',jsonb_build_object('payload',jsonb_build_object('to',recipient,'subject','September','text','stable body'))) from claimed;
select public.transition_accountant_delivery(id,lease_token,'uncertain','{"error":"lost response"}') from claimed;
do $$ begin
 begin
  perform public.transition_accountant_delivery((select id from claimed),(select lease_token from claimed),'failed','{"error":"later preparation failure"}');
  raise exception 'earlier uncertainty cleared';
 exception when raise_exception then if sqlerrm <> 'delivery lease lost' then raise; end if; end;
end $$;
create temp table retried as select * from public.claim_accountant_delivery((select id from claimed),true);
do $$ begin
 if (select lease_token from retried) = (select lease_token from claimed) then raise exception 'lease not rotated'; end if;
 if (select mail_payload->>'text' from retried) <> 'stable body' then raise exception 'retry payload changed'; end if;
 begin
  perform public.transition_accountant_delivery((select id from claimed),(select lease_token from claimed),'sent','{"resend_id":"old-worker"}');
  raise exception 'old worker accepted';
 exception when raise_exception then if sqlerrm <> 'delivery lease lost' then raise; end if; end;
end $$;
select public.transition_accountant_delivery(id,lease_token,'sending',jsonb_build_object('payload',mail_payload)) from retried;
do $$ begin
 begin
  perform public.transition_accountant_delivery((select id from retried),(select lease_token from retried),'failed','{"error":"later rejection"}');
  raise exception 'uncertain earlier submission reset';
 exception when raise_exception then if sqlerrm <> 'previous submission remains uncertain' then raise; end if; end;
end $$;
select public.transition_accountant_delivery(id,lease_token,'sent','{"resend_id":"email-accepted"}') from retried;
select public.queue_accountant_month('2026-09-01');
do $$ begin
 if (select count(*) from public.accountant_monthly_deliveries) <> 1 then raise exception 'duplicate period'; end if;
 if (public.claim_accountant_delivery((select id from claimed),true)).id is not null then raise exception 'successful email retry allowed'; end if;
 begin
  perform public.renew_accountant_delivery_link((select id from claimed),'22222222-2222-4222-8222-222222222222',repeat('c',64));
  raise exception 'cross-owner renewal allowed';
 exception when raise_exception then if sqlerrm <> 'archive unavailable' then raise; end if; end;
end $$;
select public.renew_accountant_delivery_link((select id from claimed),'11111111-1111-4111-8111-111111111111',repeat('c',64));
do $$ begin
 if (select link_token_hash from public.accountant_monthly_deliveries limit 1) <> repeat('c',64) then raise exception 'token not rotated'; end if;
end $$;
update public.profiles set accountant_email = null where provider_id = '11111111-1111-4111-8111-111111111111';
do $$ begin
 begin
  perform public.renew_accountant_delivery_link((select id from claimed),'11111111-1111-4111-8111-111111111111',repeat('d',64));
  raise exception 'removed recipient accepted';
 exception when raise_exception then if sqlerrm <> 'accountant address changed' then raise; end if; end;
end $$;
-- An ambiguous send outside the Resend idempotency window cannot be retried.
update public.profiles set accountant_email = 'alice-compta@example.test' where provider_id = '11111111-1111-4111-8111-111111111111';
insert into public.accountant_monthly_deliveries(provider_id,period_month,recipient,status,send_started_at,mail_payload)
 values ('11111111-1111-4111-8111-111111111111','2026-08-01','alice-compta@example.test','uncertain',now()-interval '24 hours','{"to":"alice-compta@example.test","text":"old"}');
do $$ begin
 if (public.claim_accountant_delivery((select id from public.accountant_monthly_deliveries where period_month='2026-08-01'),true)).id is not null then raise exception 'unsafe late retry'; end if;
end $$;
-- A first, explicitly rejected submission can be prepared again under a new lease.
insert into public.accountant_monthly_deliveries(provider_id,period_month,recipient)
 values ('11111111-1111-4111-8111-111111111111','2026-07-01','alice-compta@example.test');
create temp table rejected as select * from public.claim_accountant_delivery((select id from public.accountant_monthly_deliveries where period_month='2026-07-01'),false);
select public.transition_accountant_delivery(id,lease_token,'prepared',jsonb_build_object('archive_path','providers/'||provider_id||'/accountant-monthly/'||id||'/'||lease_token||'.zip','archive_hash',repeat('d',64),'archive_bytes',100,'exported_count',1,'missing_documents','[]'::jsonb,'link_token_hash',repeat('e',64))) from rejected;
select public.transition_accountant_delivery(id,lease_token,'sending',jsonb_build_object('payload',jsonb_build_object('to',recipient,'text','rejected'))) from rejected;
select public.transition_accountant_delivery(id,lease_token,'failed','{"error":"resend_rejected"}') from rejected;
create temp table retry_rejected as select * from public.claim_accountant_delivery((select id from rejected),true);
do $$ begin
 if (select lease_token from retry_rejected) is null or (select mail_payload from retry_rejected) is not null then raise exception 'rejected request cannot be retried'; end if;
end $$;
-- Purge reserves a row first: neither retry nor renewal can race the deletion.
update public.accountant_monthly_deliveries set archive_expires_at = now()-interval '1 day' where period_month='2026-09-01';
select public.claim_accountant_archive_cleanup((select id from claimed));
do $$ begin
 if (public.claim_accountant_delivery((select id from claimed),true)).id is not null then raise exception 'retry during purge'; end if;
end $$;
select public.purge_accountant_delivery_archive((select id from claimed));
-- A credit-note-only professional is also queued; blank recipients remain excluded.
insert into public.client_credit_notes(provider_id,issued_at) values ('33333333-3333-4333-8333-333333333333','2026-09-15T12:00:00Z');
select public.queue_accountant_month('2026-09-01');
do $$ begin
 if not exists(select 1 from public.accountant_monthly_deliveries where provider_id='33333333-3333-4333-8333-333333333333') then raise exception 'credit note omitted'; end if;
 if exists(select 1 from public.accountant_monthly_deliveries where provider_id='22222222-2222-4222-8222-222222222222') then raise exception 'blank recipient queued'; end if;
end $$;
-- Recovery and cleanup regressions: abandoned preparation is retried once,
-- the tenth attempt becomes terminal, submitted payloads remain uncertain.
insert into public.accountant_monthly_deliveries(provider_id,period_month,recipient,status,attempts,lease_token,lease_until)
 values ('11111111-1111-4111-8111-111111111111','2026-06-01','alice-compta@example.test','preparing',10,gen_random_uuid(),now()-interval '1 minute');
select public.recover_accountant_deliveries();
do $$ begin
 if not exists(select 1 from public.accountant_monthly_deliveries where period_month='2026-06-01' and status='exhausted' and lease_token is null) then raise exception 'tenth crash not terminal'; end if;
 if (public.claim_accountant_delivery((select id from public.accountant_monthly_deliveries where period_month='2026-06-01'),true)).id is not null then raise exception 'exhausted retry accepted'; end if;
end $$;
insert into public.accountant_monthly_deliveries(provider_id,period_month,recipient,status,attempts,lease_token,lease_until,mail_payload,archive_expires_at)
 values ('11111111-1111-4111-8111-111111111111','2026-05-01','alice-compta@example.test','sending',10,gen_random_uuid(),now()-interval '1 minute','{"to":"alice-compta@example.test"}',now()-interval '1 day');
select public.recover_accountant_deliveries();
do $$ begin
 if not exists(select 1 from public.accountant_monthly_deliveries where period_month='2026-05-01' and status='uncertain' and mail_payload is not null) then raise exception 'uncertainty lost at attempt limit'; end if;
 if not public.claim_accountant_archive_cleanup((select id from public.accountant_monthly_deliveries where period_month='2026-05-01')) then raise exception 'abandoned archive not purgeable'; end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.queue_accountant_month('2026-09-01'); raise exception 'authenticated execute allowed'; exception when insufficient_privilege then null; end;
 begin perform 1 from public.accountant_monthly_deliveries; raise exception 'authenticated table access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.accountant_monthly_deliveries; raise exception 'anonymous table access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Accountant monthly SQL checks passed' as result;
rollback;
