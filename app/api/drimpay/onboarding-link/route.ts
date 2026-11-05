import { getGoogleMeetReadiness } from "@/lib/googleMeetReadiness";
import { GOOGLE_MEET_REQUIRED_MESSAGE } from "@/lib/googleOAuthScopes";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import {
  requestTransfersCapability,
  resolveStripeAccountId,
} from "@/lib/stripeConnect";

export async function POST(req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (!user || error) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const googleReadiness = await getGoogleMeetReadiness(supabase, user.id);
  if (!googleReadiness.connected) {
    return NextResponse.json({ code: "GOOGLE_MEET_REQUIRED", error: GOOGLE_MEET_REQUIRED_MESSAGE }, { status: 409 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_account_id, stripe_connect_account_id")
    .eq("provider_id", user.id)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "No stripe_account_id" }, { status: 400 });
  }

  const resolvedAccount = resolveStripeAccountId(profile);

  if (!resolvedAccount.accountId || resolvedAccount.conflict) {
    return NextResponse.json({ error: "No usable Stripe account" }, { status: 409 });
  }

  if (resolvedAccount.needsCanonicalBackfill) {
    const { error: backfillError } = await supabase
      .from("profiles")
      .update({ stripe_account_id: resolvedAccount.accountId })
      .eq("provider_id", user.id);

    if (backfillError) {
      return NextResponse.json(
        { error: "Unable to normalize Stripe account reference" },
        { status: 500 }
      );
    }
  }

  const account = await stripe.accounts.retrieve(resolvedAccount.accountId);
  await requestTransfersCapability(stripe, account);

  const origin = new URL(req.url).origin;

  const link = await stripe.accountLinks.create({
    account: resolvedAccount.accountId,
    type: "account_onboarding",
    refresh_url: `${origin}/dashboard?drimpay=retry`,
    return_url: `${origin}/dashboard?drimpay=done`,
  });

  return NextResponse.json({ url: link.url });
}
