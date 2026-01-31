import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (!user || error) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_account_id")
    .eq("provider_id", user.id)
    .single();

  if (!profile?.stripe_account_id) {
    return NextResponse.json({ error: "No stripe_account_id" }, { status: 400 });
  }

  const origin = new URL(req.url).origin;

  const link = await stripe.accountLinks.create({
    account: profile.stripe_account_id,
    type: "account_onboarding",
    refresh_url: `${origin}/dashboard/profile?drimpay=retry`,
    return_url: `${origin}/dashboard/profile?drimpay=done`,
  });

  return NextResponse.json({ url: link.url });
}
