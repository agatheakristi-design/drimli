import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type AppointmentRow = {
  id: string;
  product_id: string | null;
  client_name: string | null;
  client_email: string | null;
  start_datetime: string;
  end_datetime: string;
  status: "confirmed" | "cancelled_by_provider" | "cancelled_by_client";
  video_provider: string | null;
  video_join_url: string | null;
  video_room_status: "closed" | "open" | "locked";
};

async function signedUrl(bucket?: string | null, path?: string | null) {
  if (!bucket || !path) return null;
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    ""
  );
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: payments, error: paymentsError } = await admin
    .from("drimli_payments")
    .select("id, appointment_id, amount_paid, refunded_amount, currency")
    .eq("provider_id", auth.user.id)
    .gt("refunded_amount", 0)
    .order("updated_at", { ascending: false });

  if (paymentsError) {
    return NextResponse.json({ error: paymentsError.message }, { status: 500 });
  }

  const appointmentIds = (payments || []).map((payment) => payment.appointment_id);
  if (appointmentIds.length === 0) {
    return NextResponse.json({ refunds: [] });
  }

  const { data: appointments, error: appointmentsError } = await admin
    .from("appointments")
    .select(
      "id, product_id, client_name, client_email, start_datetime, end_datetime, status, video_provider, video_join_url, video_room_status"
    )
    .eq("provider_id", auth.user.id)
    .in("id", appointmentIds);

  if (appointmentsError) {
    return NextResponse.json(
      { error: appointmentsError.message },
      { status: 500 }
    );
  }

  const appointmentRows = (appointments || []) as AppointmentRow[];
  const productIds = Array.from(
    new Set(
      appointmentRows
        .map((appointment) => appointment.product_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: products } = productIds.length
    ? await admin.from("products").select("id, title").in("id", productIds)
    : { data: [] };
  const productNames = new Map(
    (products || []).map((product) => [product.id, product.title || "Service"])
  );
  const appointmentById = new Map(
    appointmentRows.map((appointment) => [appointment.id, appointment])
  );

  const paymentIds = (payments || []).map((payment) => payment.id);
  const [{ data: invoices }, { data: refundRows }] = await Promise.all([
    admin
      .from("client_invoices")
      .select("appointment_id, invoice_number, storage_bucket, file_path")
      .in("appointment_id", appointmentIds),
    admin
      .from("drimli_refunds")
      .select("id, payment_id")
      .in("payment_id", paymentIds)
      .eq("status", "succeeded")
      .order("created_at", { ascending: false }),
  ]);
  const refundIds = (refundRows || []).map((refund) => refund.id);
  const { data: creditNoteRows } = refundIds.length
    ? await admin
        .from("client_credit_notes")
        .select(
          "id, refund_id, credit_note_number, total_including_tax, currency, storage_bucket, file_path"
        )
        .in("refund_id", refundIds)
    : { data: [] };
  const invoiceByAppointment = new Map(
    (invoices || []).map((invoice) => [invoice.appointment_id, invoice])
  );
  const refundsByPayment = new Map<string, typeof refundRows>();
  for (const refund of refundRows || []) {
    refundsByPayment.set(refund.payment_id, [
      ...(refundsByPayment.get(refund.payment_id) || []),
      refund,
    ]);
  }
  const creditNoteByRefund = new Map(
    (creditNoteRows || []).map((note) => [note.refund_id, note])
  );

  const refunds = await Promise.all((payments || []).flatMap((payment) => {
    const appointment = appointmentById.get(payment.appointment_id);
    if (!appointment) return [];

    const invoice = invoiceByAppointment.get(payment.appointment_id);
    const paymentRefunds = refundsByPayment.get(payment.id) || [];

    return [
      (async () => ({
        appointment: {
          id: appointment.id,
          product_id: appointment.product_id,
          serviceName:
            (appointment.product_id
              ? productNames.get(appointment.product_id)
              : null) || "Prestation indisponible",
          clientName: appointment.client_name?.trim() || "Client non renseigné",
          clientEmail: appointment.client_email?.trim() || null,
          start_datetime: appointment.start_datetime,
          end_datetime: appointment.end_datetime,
          status: appointment.status,
          videoProvider: appointment.video_provider,
          videoJoinUrl: appointment.video_join_url,
          videoRoomStatus: appointment.video_room_status,
        },
        amountPaid: payment.amount_paid,
        refundedAmount: payment.refunded_amount,
        currency: payment.currency,
        refundStatus:
          payment.refunded_amount >= payment.amount_paid ? "total" : "partial",
        invoice: invoice
          ? {
              invoiceNumber: invoice.invoice_number,
              downloadUrl: await signedUrl(
                invoice.storage_bucket,
                invoice.file_path
              ),
            }
          : null,
        creditNotes: await Promise.all(
          paymentRefunds.flatMap((refund) => {
            const note = creditNoteByRefund.get(refund.id);
            if (!note) return [];
            return [
              (async () => ({
                id: note.id,
                creditNoteNumber: note.credit_note_number,
                amount: note.total_including_tax,
                currency: note.currency,
                downloadUrl: await signedUrl(note.storage_bucket, note.file_path),
              }))(),
            ];
          })
        ),
      }))(),
    ];
  }));

  refunds.sort(
    (left, right) =>
      Date.parse(right.appointment.start_datetime) -
      Date.parse(left.appointment.start_datetime)
  );

  return NextResponse.json({ refunds });
}
