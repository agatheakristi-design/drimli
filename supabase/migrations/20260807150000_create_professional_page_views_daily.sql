begin;

create table public.professional_page_views_daily (
  provider_id uuid not null references auth.users(id) on delete cascade,
  view_date date not null,
  views bigint not null default 0,
  updated_at timestamptz not null default now(),

  constraint professional_page_views_daily_pkey
    primary key (provider_id, view_date),
  constraint professional_page_views_daily_views_check
    check (views >= 0)
);

comment on table public.professional_page_views_daily is
  'Daily aggregate of real openings of published professional pages.';

alter table public.professional_page_views_daily enable row level security;

create policy "Professionals can read their own page views"
on public.professional_page_views_daily
for select
to authenticated
using ((select auth.uid()) = provider_id);

-- Public writes are intentionally forbidden. Only the server-side RPC can
-- increment this aggregate.
revoke all on table public.professional_page_views_daily from anon;
grant select on table public.professional_page_views_daily to authenticated;

create or replace function public.increment_professional_page_view(
  p_provider_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where provider_id = p_provider_id
      and published is true
  ) then
    return;
  end if;

  insert into public.professional_page_views_daily (
    provider_id,
    view_date,
    views,
    updated_at
  )
  values (
    p_provider_id,
    (timezone('utc', statement_timestamp()))::date,
    1,
    statement_timestamp()
  )
  on conflict (provider_id, view_date)
  do update set
    views = public.professional_page_views_daily.views + 1,
    updated_at = statement_timestamp();
end;
$$;

revoke all on function public.increment_professional_page_view(uuid)
from public, anon, authenticated;
grant execute on function public.increment_professional_page_view(uuid)
to service_role;

commit;
