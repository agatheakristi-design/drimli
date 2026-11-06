-- Disposable local/staging database only, after both help migrations. Rolls back.
begin;
insert into auth.users(id) values ('33333333-3333-4333-8333-333333333333');
insert into public.help_requests(id,owner_id,subject,message) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','Notification test','Message');
insert into public.help_replies(request_id,message) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Reply');
set local role authenticated;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ begin
 begin
  perform public.claim_help_notification();
  raise exception 'Browser can claim notifications';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.help_notifications;
  raise exception 'Browser can read notifications';
 exception when insufficient_privilege then null; end;
end $$;
set local role service_role;
do $$
declare job public.help_notifications; frozen jsonb; second_job public.help_notifications;
begin
 select * into job from public.claim_help_notification();
 if job.id is null then raise exception 'No notification created'; end if;
 select * into second_job from public.claim_help_notification();
 if second_job.id=job.id then raise exception 'Active lease reclaimed'; end if;
 if (select count(*) from public.help_notifications where request_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>2 then raise exception 'Reconciliation missing or duplicated event'; end if;
 frozen:=public.prepare_help_notification(job.id,job.lease_token,'{"text":"frozen"}'::jsonb);
 if public.prepare_help_notification(job.id,job.lease_token,'{"text":"changed"}'::jsonb)<>frozen then raise exception 'Retry payload changed'; end if;
 if public.finish_help_notification(job.id,gen_random_uuid(),'fake',null) then raise exception 'Stale lease accepted'; end if;
 if not public.finish_help_notification(job.id,job.lease_token,null,'test_failure') then raise exception 'Failure not persisted'; end if;
 update public.help_notifications set available_at=now()-interval '1 minute' where id=job.id;
 select * into job from public.claim_help_notification();
 if job.payload<>frozen then raise exception 'Retry lost payload'; end if;
 update public.help_notifications set first_send_at=now()-interval '25 hours',lease_until=now()-interval '1 minute' where id=job.id;
 perform public.claim_help_notification();
 if not exists(select 1 from public.help_notifications where id=job.id and state='attention') then raise exception 'Unsafe replay after idempotency window'; end if;
 if second_job.id is not null then
  perform public.finish_help_notification(second_job.id,second_job.lease_token,'fixture-email',null);
  perform public.claim_help_notification();
  if not exists(select 1 from public.help_notifications where id=second_job.id and state='sent') then raise exception 'Sent notification requeued'; end if;
 end if;
end $$;
rollback;
