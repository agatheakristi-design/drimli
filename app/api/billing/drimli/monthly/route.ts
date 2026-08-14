import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  DRIMLI_BILLING_IDENTITY,
  ensureDrimliInvoicePdf,
} from "@/lib/drimliCommissionBilling";
import {
  recordCollectedCommission,
  syncRefundedCommissionMovements,
} from "@/lib/drimliCommissionLedger";

export const runtime = "nodejs";
export const maxDuration = 60;

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const admin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);
const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));

function previousMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10);
}

function monthLabel(period: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}T00:00:00Z`));
}

export async function POST(request: Request) {
  const secret = requiredEnv("CRON_SECRET");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    periodMonth?: unknown;
    providerId?: unknown;
  };
  const periodMonth =
    typeof body.periodMonth === "string" ? body.periodMonth : previousMonth();
  if (!/^\d{4}-\d{2}-01$/.test(periodMonth)) {
    return NextResponse.json({ error: "periodMonth must be YYYY-MM-01" }, { status: 400 });
  }
  const periodEnd = new Date(
    Date.UTC(Number(periodMonth.slice(0, 4)), Number(periodMonth.slice(5, 7)), 1)
  )
    .toISOString()
    .slice(0, 10);

  let paymentsQuery = admin
    .from("drimli_payments")
    .select("id, provider_id, stripe_payment_intent_id, application_fee_amount, currency, paid_at")
    .gte("paid_at", periodMonth)
    .lt("paid_at", periodEnd);
  if (typeof body.providerId === "string") {
    paymentsQuery = paymentsQuery.eq("provider_id", body.providerId);
  }
  const { data: payments, error: paymentsError } = await paymentsQuery;
  if (paymentsError) return NextResponse.json({ error: paymentsError.message }, { status: 500 });
  for (const payment of payments || []) {
    const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id, {
      expand: ["latest_charge.application_fee"],
    });
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const applicationFee = charge && typeof charge.application_fee === "object"
      ? charge.application_fee
      : null;
    if (!applicationFee) throw new Error(`Application fee missing for ${payment.id}`);
    await recordCollectedCommission(admin, payment, applicationFee.id);
    await syncRefundedCommissionMovements({
      admin,
      stripe,
      payment,
      applicationFeeId: applicationFee.id,
    });
  }

  let movementQuery = admin
    .from("drimli_commission_movements")
    .select("provider_id, currency")
    .eq("movement_type", "collected")
    .gte("effective_at", periodMonth)
    .lt("effective_at", periodEnd);
  if (typeof body.providerId === "string") {
    movementQuery = movementQuery.eq("provider_id", body.providerId);
  }
  const { data: periods, error: periodsError } = await movementQuery;
  if (periodsError) return NextResponse.json({ error: periodsError.message }, { status: 500 });

  const keys = Array.from(
    new Map(
      (periods || []).map((row) => [
        `${row.provider_id}:${row.currency}`,
        { providerId: row.provider_id, currency: row.currency },
      ])
    ).values()
  );
  const results: Array<{ providerId: string; currency: string; invoiceNumber?: string; skipped?: string }> = [];

  for (const key of keys) {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("first_name, last_name, full_name, business_name, address, postal_code, city, country, siret, vat_number, billing_information_validated_at")
      .eq("provider_id", key.providerId)
      .maybeSingle();
    if (profileError || !profile?.billing_information_validated_at) {
      results.push({ ...key, skipped: "billing_information_not_validated" });
      continue;
    }
    const customerSnapshot = {
      firstName: profile.first_name,
      lastName: profile.last_name,
      fullName: profile.full_name,
      businessName: profile.business_name,
      address: profile.address,
      postalCode: profile.postal_code,
      city: profile.city,
      country: profile.country,
      siret: profile.siret,
      vatNumber: profile.vat_number,
    };
    const { data: invoice, error } = await admin.rpc(
      "close_drimli_commission_month",
      {
        p_provider_id: key.providerId,
        p_period_month: periodMonth,
        p_currency: key.currency,
        p_issued_at: new Date().toISOString(),
        p_issuer_snapshot: DRIMLI_BILLING_IDENTITY,
        p_customer_snapshot: customerSnapshot,
        p_description: `Commissions DRIMLI – ${monthLabel(periodMonth)}`,
      }
    );
    if (error) {
      if (error.message.includes("no positive retained commission")) {
        results.push({ ...key, skipped: "no_positive_retained_commission" });
        continue;
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await ensureDrimliInvoicePdf(admin, invoice);
    results.push({ ...key, invoiceNumber: invoice.invoice_number });
  }
  return NextResponse.json({ periodMonth, results });
}
