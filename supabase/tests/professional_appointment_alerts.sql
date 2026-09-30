-- Disposable local database only, after all migrations. Synthetic fixtures roll back.
begin;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','pro@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','other@example.invalid');
insert into public.profiles(provider_id,full_name,email) values
 ('11111111-1111-4111-8111-111111111111','Pro Test','pro@example.invalid');
insert into public.products(id,provider_id,title) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Consultation');
insert into public.appointments(id,provider_id,product_id,status,start_datetime,end_datetime,client_name)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','pending','2099-01-01 10:00Z','2099-01-01 11:00Z','Client Test');
-- Simulate pre-existing confirmed booking: unrelated writes and webhook replay
-- must not manufacture a historical event.
insert into public.appointments(id,provider_id,product_id,status,start_datetime,end_datetime,stripe_payment_intent_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111',
 '33333333-3333-4333-8333-333333333333','confirmed','2099-02-01 10:00Z','2099-02-01 11:00Z','pi_old');
update public.appointments set status='confirmed' where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$begin
 if exists(select 1 from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111')) then raise exception 'Historical/pending notification'; end if;
end$$;

update public.appointments set status='confirmed',stripe_payment_intent_id='pi_fixture' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.appointments set status='confirmed',stripe_payment_intent_id='pi_fixture' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$declare p jsonb; begin
 if (select count(*) from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111')) <> 1 then raise exception 'Confirmation/replay count'; end if;
 p := public.claim_professional_appointment_email('confirmed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 if p->>'client_name' <> 'Client Test' or p->>'email_state' <> 'claimed' then raise exception 'Missing claim payload'; end if;
 if public.claim_professional_appointment_email('confirmed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is not null then raise exception 'Duplicate claim'; end if;
 perform public.finish_professional_appointment_email('confirmed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sent','email_fixture');
 if public.claim_professional_appointment_email('confirmed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is not null then raise exception 'Sent email replay'; end if;
end$$;

select public.reschedule_appointment_with_alert('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 '2099-01-01 10:00Z','2099-01-02 10:00Z','2099-01-02 11:00Z',now(),'client');
-- Stale concurrent request must fail, without a second audit/event.
do $$begin
 begin
  perform public.reschedule_appointment_with_alert('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
   '2099-01-01 10:00Z','2099-01-02 10:00Z','2099-01-02 11:00Z',now(),'client');
  raise exception 'Stale request accepted';
 exception when others then
  if sqlerrm not like '%changed concurrently%' then raise; end if;
 end;
end$$;
-- Sequential no-op must not produce another event.
select public.reschedule_appointment_with_alert('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 '2099-01-02 10:00Z','2099-01-02 10:00Z','2099-01-02 11:00Z',now(),'client');
-- Returning to the previous slot is a genuinely different event.
select public.reschedule_appointment_with_alert('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 '2099-01-02 10:00Z','2099-01-01 10:00Z','2099-01-01 11:00Z',now(),'client');
do $$begin
 if (select count(*) from public.appointment_reschedule_audit where actor='client') <> 2 then raise exception 'Move identity/count'; end if;
 if (select count(*) from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111') where payload->>'seen_at' is null) <> 3 then raise exception 'Unread count'; end if;
 if exists(select 1 from public.appointment_reschedule_audit where professional_notification->>'old_start' is null) then raise exception 'Old dates not preserved'; end if;
end$$;
-- The legacy professional entry point preserves its return type and writes actor.
select public.reschedule_paid_appointment_guarded('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',
 '2099-01-01 10:00Z','2099-01-03 10:00Z','2099-01-03 11:00Z',now());
do $$begin
 if (select count(*) from public.appointment_reschedule_audit where actor='professional' and professional_notification is null) <> 1 then raise exception 'Professional move notified'; end if;
end$$;
-- Snapshot identities retrieved on calendar entry.
create temporary table retrieved as select event_id,kind from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111');
-- A later event on the SAME appointment must remain unseen.
select public.complete_client_cancellation_with_alert('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','re_fixture');
select public.record_client_cancellation_alert('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','re_fixture');
select public.mark_professional_appointment_alerts_seen('11111111-1111-4111-8111-111111111111',(select jsonb_agg(to_jsonb(r)) from retrieved r));
do $$declare p jsonb; begin
 if (select count(*) from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111') where payload->>'seen_at' is null) <> 1 then raise exception 'New event lost during ack'; end if;
 select payload into p from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111') where kind='cancelled';
 if p->>'actor' <> 'client' or p->>'refund_id' <> 're_fixture' then raise exception 'Cancellation provenance'; end if;
 if (p->>'start')::timestamptz <> '2099-01-03 10:00Z' then raise exception 'Cancellation slot'; end if;
end$$;
-- A different professional cannot acknowledge these identities.
select public.mark_professional_appointment_alerts_seen('22222222-2222-4222-8222-222222222222',
 '[{"event_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","kind":"cancelled"}]');
do $$begin
 if not exists(select 1 from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111') where kind='cancelled' and payload->>'seen_at' is null) then raise exception 'Cross-provider ack'; end if;
end$$;
select public.mark_professional_appointment_alerts_seen('11111111-1111-4111-8111-111111111111',
 '[{"event_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","kind":"cancelled"}]');
do $$begin
 if exists(select 1 from public.professional_appointment_alerts('11111111-1111-4111-8111-111111111111') where payload->>'seen_at' is null) then raise exception 'Badge not cleared'; end if;
 if has_function_privilege('anon','public.claim_professional_appointment_email(text,uuid)','execute')
 or has_function_privilege('authenticated','public.mark_professional_appointment_alerts_seen(uuid,jsonb)','execute') then raise exception 'Public RPC exposure'; end if;
end$$;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
set local request.jwt.claim.role='authenticated';
do $$begin
 begin
  update public.appointments set professional_confirmation='{}' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  raise exception 'Forged notification accepted';
 exception when others then
  if sqlerrm not like '%trusted server code%' then raise; end if;
 end;
end$$;
reset role;
rollback;
