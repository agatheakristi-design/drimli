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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const appointmentId = body?.appointmentId as string | undefined;

    if (!appointmentId) {
      return NextResponse.json({ error: "Missing appointmentId" }, { status: 400 });
    }

    // 1) Load appointment
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from("appointments")
      .select("id, provider_id, product_id, start_datetime, end_datetime, status")
      .eq("id", appointmentId)
      .maybeSingle();

    if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 400 });
    if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
    if (appt.status !== "pending") {
      return NextResponse.json(
        { error: `Appointment must be pending (current: ${appt.status})` },
        { status: 400 }
      );
    }

    // 2) Load product (price/title)
    const { data: product, error: productErr } = await supabaseAdmin
      .from("products")
      .select("id, title, price_cents, active")
      .eq("id", appt.product_id)
      .maybeSingle();

    if (productErr) return NextResponse.json({ error: productErr.message }, { status: 400 });
    if (!product || product.active === false) {
      return NextResponse.json({ error: "Service not available" }, { status: 400 });
    }

    const amount = product.price_cents ?? 0;
    if (amount <= 0) {
      return NextResponse.json({ error: "Invalid service price" }, { status: 400 });
    }

    // 3) Load provider Stripe Connect account
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id")
      .eq("provider_id", appt.provider_id)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 400 });
    if (!prof?.stripe_account_id) {
      return NextResponse.json({ error: "Provider Stripe account not connected" }, { status: 400 });
    }

    // 4) Compute Drimli commission (MVP: 10%)
    const feeCents = Math.round(amount * 0.10);
    const feeVatRate = "0"; // MVP TVA commission = 0

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

    // 5) Create Checkout Session (Stripe Connect destination charge + fee)
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: amount,
            product_data: { name: product.title ?? "Service" },
          },
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: prof.stripe_account_id },
        metadata: {
          appointment_id: appt.id,
          provider_id: appt.provider_id,
          product_id: appt.product_id,
          drimli_fee_cents: String(feeCents),
          drimli_fee_vat_rate: feeVatRate,
        },
      },
      success_url: `${appUrl}/paiement/succes?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/paiement/annule?appointmentId=${encodeURIComponent(appointmentId)}`,
      metadata: {
        appointment_id: appt.id,
        provider_id: appt.provider_id,
        product_id: appt.product_id,
        drimli_fee_cents: String(feeCents),
        drimli_fee_vat_rate: feeVatRate,
      },
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
