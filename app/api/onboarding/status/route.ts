import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
      .select("first_name, last_name, full_name, stripe_account_id")
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

    const paymentComplete = !!prof?.stripe_account_id;

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
      (servicesComplete ? 1 : 0) +
      (paymentComplete ? 1 : 0);

    const next =
      !profileComplete
        ? "/dashboard/profile"
        : !servicesComplete
        ? "/dashboard/services"
        : !paymentComplete
        ? "/paiements"
        : "/dashboard";

    return NextResponse.json({
      profileComplete,
      paymentComplete,
      servicesComplete,
      availabilityComplete: true,
      doneCount,
      total: 3,
      accountReady: profileComplete && servicesComplete && paymentComplete,
      next,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
