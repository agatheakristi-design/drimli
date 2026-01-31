import { NextResponse } from "next/server";
import Stripe from "stripe";
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

type ProfileRow = {
  provider_id: string;
  stripe_account_id: string | null;
};

export async function POST() {
  try {
    const token = cookies().get("drimli_at")?.value;
    if (!token) {
      return NextResponse.json(
        { error: "Session manquante (cookie). Reconnecte-toi et réessaie." },
        { status: 401 }
      );
    }

    // 1) On vérifie l'utilisateur depuis le token Supabase
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json(
        { error: "Session invalide. Reconnecte-toi et réessaie." },
        { status: 401 }
      );
    }

    const providerId = userData.user.id;

    // 2) Charger le profil
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("provider_id, stripe_account_id")
      .eq("provider_id", providerId)
      .maybeSingle<ProfileRow>();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    // Si pas de ligne profile, on la crée minimalement (MVP)
    if (!prof) {
      const { error: insErr } = await supabaseAdmin.from("profiles").insert({
        provider_id: providerId,
        stripe_account_id: null,
      });

      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 400 });
      }
    }

    // 3) Créer ou réutiliser le compte Stripe Connect
    let stripeAccountId = prof?.stripe_account_id ?? null;

    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "FR",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          provider_id: providerId,
          app: "drimli",
        },
      });

      stripeAccountId = account.id;

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ stripe_account_id: stripeAccountId })
        .eq("provider_id", providerId);

      if (upErr) {
        return NextResponse.json(
          { error: "Failed to store stripe_account_id", details: upErr.message },
          { status: 500 }
        );
      }
    }

    // 4) Créer une Account Session (Stripe Connect Embedded Components)
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
