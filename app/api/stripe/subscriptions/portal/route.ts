import { NextResponse } from "next/server";
import {
  authenticatedProvider,
  GOOGLE_REVIEWS_BOOSTER,
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

    const { data: row, error } = await subscriptionsSupabaseAdmin
      .from("professional_subscriptions")
      .select("*")
      .eq("provider_id", user.id)
      .eq("product_key", GOOGLE_REVIEWS_BOOSTER)
      .maybeSingle<ProfessionalSubscriptionRow>();

    if (error || !row?.stripe_customer_id) {
      return response("Compte de facturation introuvable.", 404);
    }

    const session = await subscriptionsStripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${subscriptionAppUrl()}/dashboard`,
    });

    return NextResponse.json({ url: session.url });
  } catch {
    return response("Portail de facturation indisponible.", 500);
  }
}
