import Stripe from "stripe";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2025-01-27.acacia",
});

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

async function getUserFromCookieToken() {
  const token = cookies().get("drimli_at")?.value;
  if (!token) return { token: null, user: null, error: "Session manquante (cookie)." };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { token: null, user: null, error: "Session invalide. Reconnecte-toi." };

  return { token, user: data.user, error: null };
}

export async function POST() {
  try {
    // 1) Auth via cookie httpOnly
    const { user, error } = await getUserFromCookieToken();
    if (error || !user) {
      return NextResponse.json({ error: error || "Unauthorized" }, { status: 401 });
    }

    // 2) Lire le profile (stripe_account_id)
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("provider_id, full_name, stripe_account_id")
      .eq("provider_id", user.id)
      .maybeSingle<{ provider_id: string; full_name: string | null; stripe_account_id: string | null }>();

    if (profErr) {
      return NextResponse.json({ error: "Profiles read failed", details: profErr.message }, { status: 400 });
    }

    let stripeAccountId = prof?.stripe_account_id ?? null;

    // 3) Si pas de stripe_account_id → créer un compte Stripe Connect + le stocker
    if (!stripeAccountId) {
      const acct = await stripe.accounts.create({
        type: "express",
        email: user.email ?? undefined,
        metadata: { provider_id: user.id },
      });

      stripeAccountId = acct.id;

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_account_id: stripeAccountId })
        .eq("provider_id", user.id);

      if (upErr) {
        return NextResponse.json(
          { error: "Failed to store stripe_account_id", details: upErr.message },
          { status: 400 }
        );
      }
    }

    // 4) Créer l'Account Session (Embedded onboarding)
    const session = await stripe.accountSessions.create({
      account: stripeAccountId,
      components: {
        account_onboarding: { enabled: true },
      },
    });

    return NextResponse.json(
      {
        activated: true,
        stripe_account_id: stripeAccountId,
        client_secret: session.client_secret,
      },
      { status: 200 }
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
