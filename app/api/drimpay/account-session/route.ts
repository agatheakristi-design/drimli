import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2025-12-15.clover",
});

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1] ?? null;
}

export async function POST(req: Request) {
  try {
    // ✅ 1) Auth: Bearer token (fiable) ; fallback cookie si tu veux plus tard
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { error: "Session manquante", details: "Missing Authorization Bearer token" },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return NextResponse.json(
        { error: "Session invalide", details: userErr?.message || "No user" },
        { status: 401 }
      );
    }

    const providerId = userData.user.id;

    // ✅ 2) Lire le profil (service role => pas de souci RLS)
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("provider_id, stripe_account_id")
      .eq("provider_id", providerId)
      .maybeSingle<{ provider_id: string; stripe_account_id: string | null }>();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    const stripeAccountId = prof?.stripe_account_id ?? null;

    // Pas activé => réponse 200 (simple à gérer côté UI)
    if (!stripeAccountId) {
      return NextResponse.json({ activated: false, stripe_account_id: null }, { status: 200 });
    }

    // ✅ 3) Créer une Account Session (Stripe Connect Embedded Components)
    const accountSession = await stripe.accountSessions.create({
      account: stripeAccountId,
      components: {
        account_onboarding: { enabled: true },
      },
    });

    return NextResponse.json(
      {
        activated: true,
        stripe_account_id: stripeAccountId,
        client_secret: accountSession.client_secret,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
