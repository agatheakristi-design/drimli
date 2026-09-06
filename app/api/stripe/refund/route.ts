import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { AppointmentRefundError, refundAppointmentInFull } from "@/lib/appointmentRefund";
import { shouldRefundCancellation, type CancellationPolicy } from "@/lib/payoutPolicy";

export const runtime = "nodejs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { appointmentId?: unknown } | null;
  if (typeof body?.appointmentId !== "string") {
    return NextResponse.json({ error: "appointmentId required" }, { status: 400 });
  }

  const [{ data: payment }, { data: appointment }, { data: snapshot }] = await Promise.all([
    admin.from("drimli_payments").select("provider_id").eq("appointment_id", body.appointmentId).maybeSingle(),
    admin.from("appointments").select("status, start_datetime").eq("id", body.appointmentId).maybeSingle(),
    admin.from("billing_checkout_snapshots")
      .select("cancellation_policy, cancellation_refund_deadline_hours")
      .eq("appointment_id", body.appointmentId)
      .maybeSingle(),
  ]);
  if (!payment || !appointment) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  if (payment.provider_id !== auth.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!snapshot?.cancellation_policy) {
    return NextResponse.json({ error: "Conditions d’annulation introuvables." }, { status: 409 });
  }

  const shouldRefund = shouldRefundCancellation(
    snapshot.cancellation_policy as CancellationPolicy,
    appointment.start_datetime,
    snapshot.cancellation_refund_deadline_hours,
    new Date()
  );
  if (!shouldRefund) {
    if (appointment.status === "cancelled_by_provider") {
      return NextResponse.json({ cancelled: true, refunded: false });
    }
    const { data: cancelled, error } = await admin.rpc("cancel_paid_appointment_without_refund", {
      p_appointment_id: body.appointmentId,
      p_provider_id: payment.provider_id,
    });
    if (error || !cancelled) {
      return NextResponse.json(
        { error: "Annulation impossible pendant un versement ou un remboursement." },
        { status: 409 }
      );
    }
    return NextResponse.json({ cancelled: true, refunded: false });
  }

  try {
    return NextResponse.json(await refundAppointmentInFull({
      admin,
      stripe,
      appointmentId: body.appointmentId,
      providerId: payment.provider_id,
    }));
  } catch (error) {
    const failure = error instanceof AppointmentRefundError
      ? error
      : new AppointmentRefundError("Refund failed", 500);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
