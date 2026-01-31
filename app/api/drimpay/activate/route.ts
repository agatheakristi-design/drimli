import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized", details: "Missing Bearer token" },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Missing env", details: "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY" },
        { status: 500 }
      );
    }
    if (!serviceRoleKey) {
      return NextResponse.json(
        { error: "Missing env", details: "SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }
    if (!stripeSecretKey) {
      return NextResponse.json(
        { error: "Missing env", details: "STRIPE_SECRET_KEY" },
        { status: 500 }
      );
    }

    // 1) Valider le token utilisateur
    const supabaseUser = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: userRes, error: authError } = await supabaseUser.auth.getUser();
    const user = userRes?.user;

    if (!user || authError) {
      return NextResponse.json(
        { error: "Unauthorized", details: authError?.message || "Bad token" },
        { status: 401 }
      );
    }

    // 2) Client admin (service_role) pour lire/écrire profiles
    const supabaseAdmin = createSupabaseClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("provider_id, email, stripe_account_id")
      .eq("provider_id", user.id)
      .maybeSingle();

    if (pErr) return NextResponse.json({ error: "DB error", details: pErr.message }, { status: 500 });
    if (!profile) return NextResponse.json({ error: "Profile not found", debug_user_id: user.id }, { status: 400 });

    if (profile.stripe_account_id) {
      return NextResponse.json({ stripeAccountId: profile.stripe_account_id });
    }

    // 3) Créer le compte Stripe Express
    const stripe = new Stripe(stripeSecretKey);

    const account = await stripe.accounts.create({
      type: "express",
      country: "FR",
      email: profile.email || user.email || undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    const { error: uErr } = await supabaseAdmin
      .from("profiles")
      .update({ stripe_account_id: account.id, drimpay_status: "pending" })
      .eq("provider_id", user.id);

    if (uErr) return NextResponse.json({ error: "DB update failed", details: uErr.message }, { status: 500 });

    return NextResponse.json({ stripeAccountId: account.id });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server crash", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}

