import { NextResponse } from "next/server";
import {
  authenticatedProvider,
  GOOGLE_REVIEWS_BOOSTER,
  ProfessionalSubscriptionRow,
  subscriptionOwner,
  subscriptionsStripe,
  subscriptionsSupabaseAdmin,
  syncSubscriptionProjection,
} from "@/lib/stripeSubscriptions";

export const runtime = "nodejs";

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  try {
    const user = await authenticatedProvider(request);
    if (!user) return response("Non autorisé.", 401);

    const { data: row, error } = await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .select("*")
      .eq("provider_id", user.id)
      .eq("product_key", GOOGLE_REVIEWS_BOOSTER)
      .maybeSingle<ProfessionalSubscriptionRow>();

    if (error || !row?.stripe_subscription_id) {
      return response("Abonnement introuvable.", 404);
    }

    const current = await subscriptionsStripe.subscriptions.retrieve(
      row.stripe_subscription_id
    );
    const owner = subscriptionOwner(current);
    if (!owner || owner.providerId !== user.id) {
      return response("Non autorisé.", 403);
    }

    const subscription = await subscriptionsStripe.subscriptions.update(
      current.id,
      { cancel_at_period_end: true },
      { idempotencyKey: `drimli-subscription-cancel-${current.id}` }
    );

    await syncSubscriptionProjection({
      subscription,
      eventCreated: Math.floor(Date.now() / 1_000),
    });

    return NextResponse.json({
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      trialEndsAt: subscription.trial_end
        ? new Date(subscription.trial_end * 1_000).toISOString()
        : null,
    });
  } catch {
    return response("Résiliation indisponible.", 500);
  }
}
