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
    .select("appointment_id, amount_paid, refunded_amount, currency")
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

  const refunds = (payments || []).flatMap((payment) => {
    const appointment = appointmentById.get(payment.appointment_id);
    if (!appointment) return [];

    return [
      {
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
      },
    ];
  });

  refunds.sort(
    (left, right) =>
      Date.parse(right.appointment.start_datetime) -
      Date.parse(left.appointment.start_datetime)
  );

  return NextResponse.json({ refunds });
}
