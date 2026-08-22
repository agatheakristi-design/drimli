import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { resolveStripeAccountId } from "@/lib/stripeConnect";
import { isSelectablePolicy, REFUNDABLE_POLICY } from "@/lib/payoutPolicy";
import { setConnectedAccountPayoutMode } from "@/lib/stripePayouts";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const profileFields = "first_name, last_name, full_name, business_name, address, postal_code, city, country, siret, vat_regime, vat_number, vat_rate, cancellation_policy, billing_information_validated_at, stripe_account_id, stripe_connect_account_id, drimli_payout_mode";

async function authenticatedProfile(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return null;
  const { data: profile, error } = await admin.from("profiles").select(profileFields).eq("provider_id", data.user.id).maybeSingle();
  if (error || !profile) return null;
  return { userId: data.user.id, profile };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const authenticated = await authenticatedProfile(request);
  if (!authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profile } = authenticated;
  const values = {
    first_name: text(profile.first_name),
    last_name: text(profile.last_name),
    full_name: text(profile.full_name),
    business_name: text(profile.business_name),
    address: text(profile.address),
    postal_code: text(profile.postal_code),
    city: text(profile.city),
    country: text(profile.country),
    siret: text(profile.siret),
    vat_regime: text(profile.vat_regime) || "franchise_base",
    vat_number: text(profile.vat_number),
    vat_rate: profile.vat_rate == null ? "" : String(Number(profile.vat_rate) * 100),
    cancellation_policy: text(profile.cancellation_policy) || "non_refundable",
  };

  const resolved = resolveStripeAccountId(profile);
  if (resolved.accountId && !resolved.conflict) {
    try {
      const account = await stripe.accounts.retrieve(resolved.accountId);
      const entity = account.business_type === "company" ? account.company : account.individual;
      const address = entity?.address;
      values.business_name ||= text(account.business_profile?.name) || text(account.company?.name);
      values.first_name ||= text(account.individual?.first_name);
      values.last_name ||= text(account.individual?.last_name);
      values.full_name ||= [values.first_name, values.last_name].filter(Boolean).join(" ");
      values.address ||= [text(address?.line1), text(address?.line2)].filter(Boolean).join(", ");
      values.postal_code ||= text(address?.postal_code);
      values.city ||= text(address?.city);
      values.country ||= text(address?.country);
    } catch (error) {
      console.warn("[BILLING_STRIPE_PREFILL_UNAVAILABLE]", {
        providerId: authenticated.userId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  values.country ||= "FR";

  return NextResponse.json({ values, validated: Boolean(profile.billing_information_validated_at) });
}

export async function PUT(request: Request) {
  const authenticated = await authenticatedProfile(request);
  if (!authenticated) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Données invalides." }, { status: 400 });

  const vatRegime = text(body.vat_regime);
  const policy = text(body.cancellation_policy);
  const vatPercent = body.vat_rate === "" ? null : Number(body.vat_rate);
  const fullName = text(body.full_name) || [text(body.first_name), text(body.last_name)].filter(Boolean).join(" ");
  const required = [fullName, text(body.address), text(body.postal_code), text(body.city), text(body.country), text(body.siret)];
  if (required.some((value) => !value)) {
    return NextResponse.json({ error: "Complétez le nom, l’adresse, le code postal, la ville, le pays et le SIRET." }, { status: 400 });
  }
  if (!['franchise_base', 'standard'].includes(vatRegime)) {
    return NextResponse.json({ error: "Choisissez un régime de TVA." }, { status: 400 });
  }
  if (!isSelectablePolicy(policy)) {
    return NextResponse.json({ error: "Choisissez une politique d’annulation." }, { status: 400 });
  }
  if (vatRegime === "standard" && (!text(body.vat_number) || !Number.isFinite(vatPercent) || vatPercent! <= 0 || vatPercent! > 100)) {
    return NextResponse.json({ error: "Indiquez le numéro et le taux de TVA applicables." }, { status: 400 });
  }

  const resolved = resolveStripeAccountId(authenticated.profile);
  if (resolved.conflict) {
    return NextResponse.json({ error: "Les informations du compte Stripe sont incohérentes." }, { status: 409 });
  }

  let payoutMode = text(authenticated.profile.drimli_payout_mode) || "automatic";
  if (policy === REFUNDABLE_POLICY) {
    if (!resolved.accountId) {
      return NextResponse.json({ error: "Configurez Stripe Connect avant d’activer les remboursements." }, { status: 409 });
    }
    try {
      await setConnectedAccountPayoutMode(stripe, resolved.accountId, "manual");
      payoutMode = "manual";
    } catch (payoutError) {
      console.error("[PAYOUT_MODE_UPDATE_FAILED]", {
        providerId: authenticated.userId,
        type: payoutError instanceof Error ? payoutError.name : "unknown",
      });
      return NextResponse.json({ error: "Impossible de sécuriser les virements Stripe." }, { status: 502 });
    }
  }

  const { error } = await admin.from("profiles").update({
    first_name: text(body.first_name) || null,
    last_name: text(body.last_name) || null,
    full_name: fullName,
    business_name: text(body.business_name) || null,
    address: text(body.address),
    postal_code: text(body.postal_code),
    city: text(body.city),
    country: text(body.country).toUpperCase(),
    siret: text(body.siret),
    vat_regime: vatRegime,
    vat_number: vatRegime === "standard" ? text(body.vat_number) : null,
    vat_rate: vatRegime === "standard" ? vatPercent! / 100 : 0,
    cancellation_policy: policy,
    drimli_payout_mode: payoutMode,
    billing_information_validated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("provider_id", authenticated.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ saved: true });
}
