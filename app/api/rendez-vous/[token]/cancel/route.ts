import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { AppointmentRefundError, refundAppointmentInFull } from "@/lib/appointmentRefund";
import { clientAppointmentPermissions } from "@/lib/clientAppointmentPolicy";
import { sendAppointmentCancelledEmail } from "@/lib/email";
import type { CancellationPolicy } from "@/lib/payoutPolicy";

export const runtime = "nodejs";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!token || token.length > 200) return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  const { data: appointment } = await admin.from("appointments")
    .select("id, provider_id, product_id, client_email, start_datetime, status")
    .eq("join_token", token).maybeSingle();
  if (!appointment) return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  const { data: snapshot } = await admin.from("billing_checkout_snapshots")
    .select("cancellation_policy").eq("appointment_id", appointment.id).maybeSingle();
  if (!snapshot?.cancellation_policy) return NextResponse.json({ error: "Conditions introuvables." }, { status: 409 });
  const permissions = clientAppointmentPermissions(
    snapshot.cancellation_policy as CancellationPolicy,
    appointment.start_datetime,
    new Date()
  );
  if (!permissions.canCancel || appointment.status !== "confirmed") {
    return NextResponse.json({ error: "Ce rendez-vous ne peut plus être annulé depuis ce lien." }, { status: 409 });
  }

  try {
    const result = await refundAppointmentInFull({
      admin, stripe, appointmentId: appointment.id, providerId: appointment.provider_id,
    });
    if (!result.refunded) throw new AppointmentRefundError("Le remboursement n’a pas abouti.", 500);
    const [{ data: profile }, { data: product }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("provider_id", appointment.provider_id).maybeSingle(),
      admin.from("products").select("title").eq("id", appointment.product_id).maybeSingle(),
    ]);
    try {
      await sendAppointmentCancelledEmail({
        appointmentId: appointment.id,
        refundId: result.refundId,
        to: appointment.client_email,
        providerName: profile?.full_name?.trim() || "Votre professionnel",
        serviceTitle: product?.title?.trim() || "Rendez-vous",
      });
    } catch (emailError) {
      console.error("[CLIENT_CANCELLATION_EMAIL_ERROR]", {
        appointmentId: appointment.id,
        refundId: result.refundId,
        type: emailError instanceof Error ? emailError.name : "UnknownError",
        message: "Cancellation confirmation email failed",
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const failure = error instanceof AppointmentRefundError
      ? error
      : new AppointmentRefundError("Annulation impossible.", 500);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
