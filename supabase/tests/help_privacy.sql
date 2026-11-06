-- Disposable local database only, after the help migration.
begin;
insert into auth.users(id) values
('11111111-1111-4111-8111-111111111111'),
('22222222-2222-4222-8222-222222222222');
insert into public.help_requests(id,owner_id,subject,message) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','A','Private A'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','B','Private B');
insert into public.help_replies(request_id,message) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Reply A'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Reply B');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$ begin
 if (select count(*) from public.help_requests) <> 1 then raise exception 'Own request visibility failed'; end if;
 if exists(select 1 from public.help_requests where subject='B') then raise exception 'Cross-user request exposure'; end if;
 if (select count(*) from public.help_replies) <> 1 then raise exception 'Reply isolation failed'; end if;
 if exists(select 1 from public.help_replies where message='Reply B') then raise exception 'Cross-user reply exposure'; end if;
 begin
  insert into public.help_requests(owner_id,subject,message) values ('22222222-2222-4222-8222-222222222222','Spoof','Denied');
  raise exception 'Owner spoof allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.help_replies(request_id,message) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fake staff');
  raise exception 'Reply spoof allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.help_requests set subject='Changed';
  raise exception 'Update allowed';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.help_requests;
  raise exception 'Delete allowed';
 exception when insufficient_privilege then null; end;
end $$;
insert into public.help_requests(subject,message) values ('New','Own request');
do $$ begin
 if not exists(select 1 from public.help_requests where subject='New' and owner_id=auth.uid()) then raise exception 'Default owner failed'; end if;
end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
 if (select count(*) from public.help_requests) <> 1 or (select count(*) from public.help_replies) <> 1 then raise exception 'Second user isolation failed'; end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform * from public.help_requests;
  raise exception 'Anonymous read allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform * from public.help_replies;
  raise exception 'Anonymous reply read allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.help_requests(subject,message) values ('Anon','Denied');
  raise exception 'Anonymous insert allowed';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
