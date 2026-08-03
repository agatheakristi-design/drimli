begin;

update public.appointments
set video_provider = 'none'
where video_provider in ('whatsapp', 'jitsi');

alter table public.appointments
  drop constraint if exists appointments_video_provider_check;

alter table public.appointments
  add constraint appointments_video_provider_check
  check (video_provider in ('none', 'google_meet'));

commit;
