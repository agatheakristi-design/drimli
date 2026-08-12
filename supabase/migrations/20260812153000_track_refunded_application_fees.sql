begin;
alter table public.drimli_payments
  add column if not exists refunded_application_fee_amount bigint not null default 0
  check (refunded_application_fee_amount >= 0);
commit;
