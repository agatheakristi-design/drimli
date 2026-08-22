import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const { data: cancelled, error } = await admin.rpc("cancel_paid_appointment_without_refund", {
    p_appointment_id: id,
    p_provider_id: data.user.id,
  });
  if (error || !cancelled) {
    return NextResponse.json({ error: "Annulation impossible pendant un versement ou un remboursement." }, { status: 409 });
  }
  return NextResponse.json({ cancelled: true });
}
