begin;
create table public.help_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 1 and 120),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index help_requests_owner_created on public.help_requests(owner_id, created_at desc);
create table public.help_replies (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.help_requests(id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index help_replies_request_created on public.help_replies(request_id, created_at);
alter table public.help_requests enable row level security;
alter table public.help_replies enable row level security;
revoke all on public.help_requests, public.help_replies from anon, authenticated;
grant select on public.help_requests, public.help_replies to authenticated;
grant insert (subject, message) on public.help_requests to authenticated;
grant all on public.help_requests, public.help_replies to service_role;
create policy help_requests_read_own on public.help_requests for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy help_requests_create_own on public.help_requests for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy help_replies_read_own on public.help_replies for select to authenticated
  using (exists (select 1 from public.help_requests r where r.id = request_id and r.owner_id = (select auth.uid())));
commit;
