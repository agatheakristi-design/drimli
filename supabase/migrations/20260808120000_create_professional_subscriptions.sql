begin;

create table public.professional_subscriptions (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete cascade,
  product_key text not null,
  stripe_customer_id text null,
  stripe_subscription_id text null,
  stripe_checkout_session_id text null,
  status text null,
  trial_started_at timestamptz null,
  trial_ends_at timestamptz null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz null,
  last_stripe_event_created_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint professional_subscriptions_provider_product_unique
    unique (provider_id, product_key),
  constraint professional_subscriptions_product_key_check
    check (product_key = 'google_reviews_booster'),
  constraint professional_subscriptions_status_check
    check (
      status is null or status in (
        'incomplete',
        'incomplete_expired',
        'trialing',
        'active',
        'past_due',
        'unpaid',
        'canceled',
        'paused'
      )
    )
);

create unique index professional_subscriptions_customer_unique
  on public.professional_subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index professional_subscriptions_subscription_unique
  on public.professional_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index professional_subscriptions_checkout_unique
  on public.professional_subscriptions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.professional_subscriptions enable row level security;

create policy "Professionals can read their own subscriptions"
on public.professional_subscriptions
for select
to authenticated
using ((select auth.uid()) = provider_id);

-- No browser write policy is intentional. Subscription state is projected
-- exclusively by authenticated server routes and the signed Stripe webhook.

create table public.stripe_subscription_webhook_events (
  id text primary key,
  type text not null,
  stripe_created_at timestamptz not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_subscription_webhook_events enable row level security;

-- No browser policies are intentional for webhook idempotency records.

commit;
