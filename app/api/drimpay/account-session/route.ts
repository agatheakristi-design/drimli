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
  apiVersion: "2025-01-27.acacia",
});

const supabaseAdmin = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

// ⚠️ Cookie posé par /api/auth/set-cookie
function readCookie(req: Request, name: string): string | null {
  const c = req.headers.get("cookie") || "";
  const m = c.match(new RegExp(`(?:^|; )${name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function POST(req: Request) {
  try {
    const accessToken = readCookie(req, "drimli_at");
    if (!accessToken) {
      return NextResponse.json(
        { error: "Session manquante (cookie). Reconnecte-toi et réessaie." },
        { status: 401 }
      );
    }

    // 1) Identifier l'utilisateur via Supabase (avec le JWT)
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    const user = userData?.user;

    if (userErr || !user) {
      return NextResponse.json(
        { error: "Session invalide. Reconnecte-toi et réessaie." },
        { status: 401 }
      );
    }

    const providerId = user.id;

    // 2) Lire le profil (stripe_account_id)
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id, full_name")
      .eq("provider_id", providerId)
      .maybeSingle<{ stripe_account_id: string | null; full_name: string | null }>();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    // 3) Si pas de compte Stripe → le créer + stocker
    let stripeAccountId = prof?.stripe_account_id ?? null;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        // pays / business_type : adapte si besoin
        country: "FR",
        metadata: { provider_id: providerId },
      });

      stripeAccountId = account.id;

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_account_id: stripeAccountId })
        .eq("provider_id", providerId);

      if (upErr) {
        return NextResponse.json(
          { error: "Impossible d’enregistrer le compte Stripe", details: upErr.message },
          { status: 500 }
        );
      }
    }

    // 4) Créer une Account Session (Stripe Connect Embedded Components)
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
