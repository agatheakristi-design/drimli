begin;

alter table public.appointments
  add column if not exists google_review_request_sent_at timestamptz null;

-- Existing appointments predate this automation and must never receive a
-- delayed review request when the cron is enabled for the first time.
update public.appointments
set google_review_request_sent_at = now()
where end_datetime <= now()
  and google_review_request_sent_at is null;

create index if not exists appointments_google_review_request_due_idx
  on public.appointments (end_datetime)
  where status = 'confirmed'
    and client_email is not null
    and google_review_request_sent_at is null;

create or replace function public.protect_google_review_request_sent_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.google_review_request_sent_at is distinct from old.google_review_request_sent_at
    and coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'google_review_request_sent_at can only be changed by trusted server code';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_protect_google_review_request_sent_at
on public.appointments;

create trigger appointments_protect_google_review_request_sent_at
before update of google_review_request_sent_at on public.appointments
for each row
execute function public.protect_google_review_request_sent_at();

comment on column public.appointments.google_review_request_sent_at is
  'Timestamp of the idempotent post-appointment Google review request email.';

commit;
