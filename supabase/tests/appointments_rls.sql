-- Run only in a disposable local database after the historical appointments
-- table/policies and the new migration have been loaded. Fixtures are synthetic.
begin;
insert into public.appointments (id,provider_id,product_id,status,start_datetime,end_datetime,join_token,client_name,client_email,client_phone,video_join_url,video_room_id,stripe_payment_intent_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',gen_random_uuid(),'confirmed','2099-01-01 10:00Z','2099-01-01 11:00Z','fixture-a','Synthetic A','a@example.invalid','000','https://meet.google.com/aaa-bbbb-ccc','event-a','pi_fixture'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222',gen_random_uuid(),'confirmed','2099-01-01 10:00Z','2099-01-01 11:00Z','fixture-b','Synthetic B','b@example.invalid','000','https://meet.google.com/ddd-eeee-fff','event-b','pi_fixture_b');
set local role anon;
do $$ begin
 if exists(select client_name,client_email,client_phone,video_join_url,video_room_id,join_token,access_token,stripe_payment_intent_id from public.appointments) then raise exception 'Anonymous data exposure'; end if;
 if exists(select 1 from public.appointments where join_token='fixture-a') then raise exception 'Direct token lookup must not grant anon access'; end if;
end $$;
-- INSERT without RETURNING remains supported by the unchanged pending policy.
insert into public.appointments(provider_id,product_id,status,start_datetime,end_datetime)
values ('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'pending','2099-01-02 10:00Z','2099-01-02 11:00Z');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$ begin
 if (select count(*) from public.appointments) <> 2 then raise exception 'Provider own read failed'; end if;
 if exists(select 1 from public.appointments where provider_id<>auth.uid()) then raise exception 'Cross-provider read'; end if;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
 if (select count(*) from public.appointments) <> 1 then raise exception 'Second provider read failed'; end if;
end $$;
set local role service_role;
do $$ begin
 if (select count(*) from public.appointments where join_token='fixture-a') <> 1 then raise exception 'Server portal lookup failed'; end if;
 if exists(select 1 from public.appointments where join_token='invalid-fixture') then raise exception 'Invalid token resolved'; end if;
end $$;
update public.appointments set start_datetime='2099-01-03 10:00Z',end_datetime='2099-01-03 11:00Z' where join_token='fixture-a';
update public.appointments set status='cancelled' where join_token='fixture-b';
do $$ begin
 if not exists(select 1 from public.appointments where join_token='fixture-a' and start_datetime='2099-01-03 10:00Z') then raise exception 'Server move failed'; end if;
 if not exists(select 1 from public.appointments where join_token='fixture-b' and status='cancelled') then raise exception 'Server cancellation failed'; end if;
end $$;
rollback;
