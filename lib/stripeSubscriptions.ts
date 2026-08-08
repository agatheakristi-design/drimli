import "server-only";

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const GOOGLE_REVIEWS_BOOSTER = "google_reviews_booster" as const;
export const GOOGLE_REVIEWS_BOOSTER_TRIAL_DAYS = 60;

export const SUBSCRIPTION_STATUSES = [
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
  "paused",
] as const;

export type ProfessionalSubscriptionStatus =
  (typeof SUBSCRIPTION_STATUSES)[number];

export type ProfessionalSubscriptionRow = {
  id: string;
  provider_id: string;
  product_key: typeof GOOGLE_REVIEWS_BOOSTER;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  status: ProfessionalSubscriptionStatus | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  last_stripe_event_created_at: string | null;
  created_at: string;
  updated_at: string;
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export const subscriptionsStripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2025-12-15.clover",
});

export const subscriptionsSupabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

export function googleReviewsBoosterPriceId() {
  return requireEnv("STRIPE_GOOGLE_REVIEWS_BOOSTER_PRICE_ID");
}

export function subscriptionsWebhookSecret() {
  return requireEnv("STRIPE_SUBSCRIPTIONS_WEBHOOK_SECRET");
}

export function subscriptionAppUrl() {
  return requireEnv("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
}

export function isTerminalSubscriptionStatus(
  status: Stripe.Subscription.Status
) {
  return status === "canceled" || status === "incomplete_expired";
}

function timestampToIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value * 1_000).toISOString() : null;
}

function currentPeriodEnd(subscription: Stripe.Subscription) {
  const ends = subscription.items.data.map((item) => item.current_period_end);
  return ends.length > 0 ? Math.max(...ends) : null;
}

export function subscriptionProjection(subscription: Stripe.Subscription) {
  return {
    stripe_customer_id:
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    status: subscription.status as ProfessionalSubscriptionStatus,
    trial_started_at: timestampToIso(subscription.trial_start),
    trial_ends_at: timestampToIso(subscription.trial_end),
    current_period_end: timestampToIso(currentPeriodEnd(subscription)),
    cancel_at_period_end: subscription.cancel_at_period_end,
    canceled_at: timestampToIso(subscription.canceled_at),
  };
}

export function subscriptionOwner(subscription: Stripe.Subscription) {
  const providerId = subscription.metadata.provider_id;
  const productKey = subscription.metadata.product_key;

  if (!providerId || productKey !== GOOGLE_REVIEWS_BOOSTER) return null;
  return { providerId, productKey: GOOGLE_REVIEWS_BOOSTER };
}

export async function syncSubscriptionProjection(params: {
  subscription: Stripe.Subscription;
  eventCreated: number;
  checkoutSessionId?: string | null;
}) {
  const owner = subscriptionOwner(params.subscription);
  if (!owner) throw new Error("Subscription metadata is invalid.");

  const eventCreatedAt = new Date(params.eventCreated * 1_000).toISOString();
  const projection = {
    ...subscriptionProjection(params.subscription),
    ...(params.checkoutSessionId
      ? { stripe_checkout_session_id: params.checkoutSessionId }
      : {}),
    last_stripe_event_created_at: eventCreatedAt,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: existingError } =
    await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .select("id")
      .eq("provider_id", owner.providerId)
      .eq("product_key", owner.productKey)
      .maybeSingle<{ id: string }>();

  if (existingError) throw existingError;

  if (!existing) {
    const { error: insertError } = await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .insert({
        provider_id: owner.providerId,
        product_key: owner.productKey,
        ...projection,
      });

    if (!insertError) return;
    if (insertError.code !== "23505") throw insertError;
  }

  const { error: updateError } = await subscriptionsSupabaseAdmin
    .from("professional_subscriptions")
    .update(projection)
    .eq("provider_id", owner.providerId)
    .eq("product_key", owner.productKey)
    .or(
      `last_stripe_event_created_at.is.null,last_stripe_event_created_at.lte.${eventCreatedAt}`
    );

  if (updateError) throw updateError;
}

export async function authenticatedProvider(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  let accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!accessToken) {
    const cookie = request.headers.get("cookie") ?? "";
    const match = cookie.match(/(?:^|;\s*)drimli_at=([^;]+)/);
    accessToken = match ? decodeURIComponent(match[1]) : null;
  }

  if (!accessToken) return null;

  const { data, error } =
    await subscriptionsSupabaseAdmin.auth.getUser(accessToken);
  return error || !data.user ? null : data.user;
}
