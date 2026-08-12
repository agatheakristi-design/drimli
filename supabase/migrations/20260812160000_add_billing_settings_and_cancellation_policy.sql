begin;

alter table public.profiles
  add column if not exists billing_information_validated_at timestamptz null,
  add column if not exists cancellation_policy text not null default 'flexible';

alter table public.profiles
  drop constraint if exists profiles_cancellation_policy_check,
  add constraint profiles_cancellation_policy_check
    check (cancellation_policy in ('flexible', 'moderate', 'non_refundable'));

alter table public.appointments
  add column if not exists cancellation_policy text null,
  add column if not exists cancellation_refund_deadline_hours integer null;

alter table public.appointments
  drop constraint if exists appointments_cancellation_policy_check,
  add constraint appointments_cancellation_policy_check
    check (cancellation_policy is null or cancellation_policy in ('flexible', 'moderate', 'non_refundable')),
  drop constraint if exists appointments_cancellation_deadline_check,
  add constraint appointments_cancellation_deadline_check
    check (
      cancellation_policy is null
      or (cancellation_policy = 'flexible' and cancellation_refund_deadline_hours = 24)
      or (cancellation_policy = 'moderate' and cancellation_refund_deadline_hours = 48)
      or (cancellation_policy = 'non_refundable' and cancellation_refund_deadline_hours is null)
    );

alter table public.billing_checkout_snapshots
  add column if not exists cancellation_policy text null,
  add column if not exists cancellation_refund_deadline_hours integer null;

alter table public.billing_checkout_snapshots
  drop constraint if exists billing_checkout_snapshots_cancellation_policy_check,
  add constraint billing_checkout_snapshots_cancellation_policy_check
    check (cancellation_policy is null or cancellation_policy in ('flexible', 'moderate', 'non_refundable')),
  drop constraint if exists billing_checkout_snapshots_cancellation_deadline_check,
  add constraint billing_checkout_snapshots_cancellation_deadline_check
    check (
      cancellation_policy is null
      or (cancellation_policy = 'flexible' and cancellation_refund_deadline_hours = 24)
      or (cancellation_policy = 'moderate' and cancellation_refund_deadline_hours = 48)
      or (cancellation_policy = 'non_refundable' and cancellation_refund_deadline_hours is null)
    );

commit;
