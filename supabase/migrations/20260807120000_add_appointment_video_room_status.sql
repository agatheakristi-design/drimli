begin;

alter table public.appointments
  add column if not exists video_room_status text not null default 'closed';

alter table public.appointments
  drop constraint if exists appointments_video_room_status_check;

alter table public.appointments
  add constraint appointments_video_room_status_check
  check (video_room_status in ('closed', 'open', 'locked'));

create or replace function public.protect_appointment_video_room_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.video_room_status is distinct from old.video_room_status
    and coalesce(auth.role(), '') <> 'service_role'
    and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'video_room_status can only be changed by trusted server code';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_protect_video_room_status
on public.appointments;

create trigger appointments_protect_video_room_status
before update of video_room_status on public.appointments
for each row
execute function public.protect_appointment_video_room_status();

comment on column public.appointments.video_room_status is
  'Provider-controlled, video-provider-independent client room access state.';

commit;
