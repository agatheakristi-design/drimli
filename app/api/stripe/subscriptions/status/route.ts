import { NextResponse } from "next/server";
import {
  authenticatedProvider,
  GOOGLE_REVIEWS_BOOSTER,
  ProfessionalSubscriptionRow,
  subscriptionOwner,
  subscriptionProjection,
  subscriptionsStripe,
  subscriptionsSupabaseAdmin,
} from "@/lib/stripeSubscriptions";

export const runtime = "nodejs";

function publicSubscription(row: ProfessionalSubscriptionRow | null) {
  if (!row) return null;
  return {
    status: row.status,
    trial_ends_at: row.trial_ends_at,
    current_period_end: row.current_period_end,
    cancel_at_period_end: row.cancel_at_period_end,
  };
}

export async function GET(request: Request) {
  try {
    const user = await authenticatedProvider(request);
    if (!user) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }

    const { data: row, error } = await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .select("*")
      .eq("provider_id", user.id)
      .eq("product_key", GOOGLE_REVIEWS_BOOSTER)
      .maybeSingle<ProfessionalSubscriptionRow>();

    if (error) {
      return NextResponse.json(
        { error: "État de l’abonnement indisponible." },
        { status: 503 }
      );
    }
    if (!row) return NextResponse.json({ subscription: null });

    let subscriptionId = row.stripe_subscription_id;
    if (!subscriptionId && row.stripe_checkout_session_id) {
      const session = await subscriptionsStripe.checkout.sessions.retrieve(
        row.stripe_checkout_session_id
      );
      subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id ?? null;
    }

    if (!subscriptionId) {
      return NextResponse.json({ subscription: publicSubscription(row) });
    }

    const subscription =
      await subscriptionsStripe.subscriptions.retrieve(subscriptionId);
    const owner = subscriptionOwner(subscription);
    if (!owner || owner.providerId !== user.id) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
    }

    const projection = subscriptionProjection(subscription);
    const { error: updateError } = await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .update({
        ...projection,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updateError) {
      return NextResponse.json(
        { error: "État de l’abonnement indisponible." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      subscription: {
        status: projection.status,
        trial_ends_at: projection.trial_ends_at,
        current_period_end: projection.current_period_end,
        cancel_at_period_end: projection.cancel_at_period_end,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "État de l’abonnement indisponible." },
      { status: 500 }
    );
  }
}
