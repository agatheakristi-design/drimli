begin;

create unique index if not exists appointments_join_token_unique
on public.appointments(join_token)
where join_token is not null;

comment on column public.appointments.join_token is
  'Cryptographically random client portal token generated only by trusted server code.';

commit;
