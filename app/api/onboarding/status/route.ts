import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  resolveStripeAccountId,
  stripeAccountState,
} from "@/lib/stripeConnect";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function isFilled(v?: string | null) {
  return !!(v && v.trim().length > 0);
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = userData.user.id;

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select(
        "first_name, last_name, full_name, stripe_account_id, stripe_connect_account_id, drimpay_status"
      )
      .eq("provider_id", userId)
      .maybeSingle();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }

    const profileComplete =
      !!prof &&
      (
        (isFilled(prof.first_name) && isFilled(prof.last_name)) ||
        isFilled(prof.full_name)
      );

    let paymentComplete = false;

    if (prof) {
      const resolvedAccount = resolveStripeAccountId(prof);

      if (resolvedAccount.accountId && !resolvedAccount.conflict) {
        try {
          const account = await stripe.accounts.retrieve(
            resolvedAccount.accountId
          );
          paymentComplete = stripeAccountState(account).ready;
        } catch {
          paymentComplete = false;
        }
      }

      const normalizedStatus = paymentComplete ? "active" : "pending";

      if (prof.drimpay_status !== normalizedStatus) {
        await supabaseAdmin
          .from("profiles")
          .update({ drimpay_status: normalizedStatus })
          .eq("provider_id", userId);
      }
    }

    const { count: prodCount, error: prodErr } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", userId)
      .eq("active", true);

    if (prodErr) {
      return NextResponse.json({ error: prodErr.message }, { status: 500 });
    }

    const servicesComplete = (prodCount ?? 0) > 0;

    const doneCount =
      (profileComplete ? 1 : 0) +
      (servicesComplete ? 1 : 0);

    const next =
      !profileComplete
        ? "/dashboard"
        : !servicesComplete
        ? "/dashboard/services"
        : "/dashboard";

    return NextResponse.json({
      profileComplete,
      paymentComplete,
      servicesComplete,
      availabilityComplete: true,
      doneCount,
      total: 2,
      accountReady: profileComplete && servicesComplete,
      next,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}
