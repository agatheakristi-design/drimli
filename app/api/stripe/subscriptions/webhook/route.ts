import Stripe from "stripe";
import { NextResponse } from "next/server";
import {
  GOOGLE_REVIEWS_BOOSTER,
  subscriptionOwner,
  subscriptionsStripe,
  subscriptionsSupabaseAdmin,
  subscriptionsWebhookSecret,
  syncSubscriptionProjection,
} from "@/lib/stripeSubscriptions";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

async function subscriptionFromInvoice(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription;
  const subscriptionId =
    typeof subscription === "string" ? subscription : subscription?.id;
  return subscriptionId
    ? subscriptionsStripe.subscriptions.retrieve(subscriptionId)
    : null;
}

async function processEvent(event: Stripe.Event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (
      session.mode !== "subscription" ||
      session.metadata?.product_key !== GOOGLE_REVIEWS_BOOSTER
    ) {
      return;
    }

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id;
    if (!subscriptionId) throw new Error("Checkout has no subscription.");

    const subscription = await subscriptionsStripe.subscriptions.retrieve(
      subscriptionId
    );
    if (!subscriptionOwner(subscription)) return;
    await syncSubscriptionProjection({
      subscription,
      eventCreated: event.created,
      checkoutSessionId: session.id,
    });
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    if (!subscriptionOwner(subscription)) return;
    await syncSubscriptionProjection({
      subscription,
      eventCreated: event.created,
    });
    return;
  }

  if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
    const subscription = await subscriptionFromInvoice(
      event.data.object as Stripe.Invoice
    );
    if (!subscription) return;
    if (!subscriptionOwner(subscription)) return;
    await syncSubscriptionProjection({
      subscription,
      eventCreated: event.created,
    });
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Signature manquante." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = subscriptionsStripe.webhooks.constructEvent(
      await request.text(),
      signature,
      subscriptionsWebhookSecret()
    );
  } catch {
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const { data: processed, error: processedError } =
    await subscriptionsSupabaseAdmin
      .from("stripe_subscription_webhook_events")
      .select("id")
      .eq("id", event.id)
      .maybeSingle<{ id: string }>();

  if (processedError) {
    return NextResponse.json({ error: "Traitement indisponible." }, { status: 500 });
  }
  if (processed) return NextResponse.json({ received: true, idempotent: true });

  try {
    await processEvent(event);

    const { error: markerError } = await subscriptionsSupabaseAdmin
      .from("stripe_subscription_webhook_events")
      .insert({
        id: event.id,
        type: event.type,
        stripe_created_at: new Date(event.created * 1_000).toISOString(),
      });

    if (markerError && markerError.code !== "23505") throw markerError;
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Traitement indisponible." }, { status: 500 });
  }
}
