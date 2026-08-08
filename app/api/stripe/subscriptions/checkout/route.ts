import { NextResponse } from "next/server";
import {
  authenticatedProvider,
  GOOGLE_REVIEWS_BOOSTER,
  GOOGLE_REVIEWS_BOOSTER_TRIAL_DAYS,
  googleReviewsBoosterPriceId,
  isTerminalSubscriptionStatus,
  ProfessionalSubscriptionRow,
  subscriptionAppUrl,
  subscriptionsStripe,
  subscriptionsSupabaseAdmin,
} from "@/lib/stripeSubscriptions";

export const runtime = "nodejs";

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  try {
    const user = await authenticatedProvider(request);
    if (!user) return response("Non autorisé.", 401);

    let { data: row, error: rowError } = await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .select("*")
      .eq("provider_id", user.id)
      .eq("product_key", GOOGLE_REVIEWS_BOOSTER)
      .maybeSingle<ProfessionalSubscriptionRow>();

    if (rowError) return response("Activation indisponible.", 503);

    if (!row) {
      const { error: insertError } = await subscriptionsSupabaseAdmin
        .from("professional_subscriptions")
        .insert({ provider_id: user.id, product_key: GOOGLE_REVIEWS_BOOSTER });

      if (insertError && insertError.code !== "23505") {
        return response("Activation indisponible.", 503);
      }

      const result = await subscriptionsSupabaseAdmin
        .from("professional_subscriptions")
        .select("*")
        .eq("provider_id", user.id)
        .eq("product_key", GOOGLE_REVIEWS_BOOSTER)
        .single<ProfessionalSubscriptionRow>();
      row = result.data;
      rowError = result.error;
    }

    if (rowError || !row) return response("Activation indisponible.", 503);

    if (row.stripe_subscription_id) {
      const subscription = await subscriptionsStripe.subscriptions.retrieve(
        row.stripe_subscription_id
      );
      if (!isTerminalSubscriptionStatus(subscription.status)) {
        return response("Un abonnement existe déjà.", 409);
      }
    }

    let customerId = row.stripe_customer_id;
    if (!customerId) {
      const customer = await subscriptionsStripe.customers.create(
        {
          email: user.email ?? undefined,
          metadata: { provider_id: user.id, app: "drimli" },
        },
        { idempotencyKey: `drimli-customer-${user.id}` }
      );
      customerId = customer.id;

      const { error: customerStoreError } = await subscriptionsSupabaseAdmin
        .from("professional_subscriptions")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .is("stripe_customer_id", null);

      if (customerStoreError) return response("Activation indisponible.", 503);
    }

    const subscriptions = await subscriptionsStripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    const blockingSubscription = subscriptions.data.find(
      (subscription) =>
        subscription.metadata.provider_id === user.id &&
        subscription.metadata.product_key === GOOGLE_REVIEWS_BOOSTER &&
        !isTerminalSubscriptionStatus(subscription.status)
    );
    if (blockingSubscription) {
      return response("Un abonnement existe déjà.", 409);
    }

    if (row.stripe_checkout_session_id) {
      const existingSession = await subscriptionsStripe.checkout.sessions.retrieve(
        row.stripe_checkout_session_id
      );
      if (existingSession.status === "open" && existingSession.url) {
        return NextResponse.json({ url: existingSession.url });
      }
      if (existingSession.subscription) {
        const existingSubscriptionId =
          typeof existingSession.subscription === "string"
            ? existingSession.subscription
            : existingSession.subscription.id;
        const existingSubscription =
          await subscriptionsStripe.subscriptions.retrieve(
            existingSubscriptionId
          );
        if (!isTerminalSubscriptionStatus(existingSubscription.status)) {
          return response("Un abonnement existe déjà.", 409);
        }
      }
    }

    const appUrl = subscriptionAppUrl();
    const attemptKey = row.stripe_checkout_session_id ?? "initial";
    const metadata = {
      provider_id: user.id,
      product_key: GOOGLE_REVIEWS_BOOSTER,
    };

    const session = await subscriptionsStripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        payment_method_collection: "always",
        line_items: [
          { price: googleReviewsBoosterPriceId(), quantity: 1 },
        ],
        subscription_data: {
          trial_period_days: GOOGLE_REVIEWS_BOOSTER_TRIAL_DAYS,
          metadata,
        },
        metadata,
        success_url: `${appUrl}/dashboard?subscription=success`,
        cancel_url: `${appUrl}/dashboard?subscription=cancelled`,
      },
      {
        idempotencyKey: `drimli-subscription-checkout-${user.id}-${GOOGLE_REVIEWS_BOOSTER}-${attemptKey}`,
      }
    );

    if (!session.url) return response("Activation indisponible.", 503);

    const { error: sessionStoreError } = await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .update({
        stripe_customer_id: customerId,
        stripe_checkout_session_id: session.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (sessionStoreError) return response("Activation indisponible.", 503);

    return NextResponse.json({ url: session.url });
  } catch {
    return response("Activation indisponible.", 500);
  }
}
