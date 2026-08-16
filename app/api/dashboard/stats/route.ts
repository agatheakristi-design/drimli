import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const { data, error } = await admin.from("drimli_payments").select("amount_paid, application_fee_amount, refunded_amount, refunded_application_fee_amount").eq("provider_id", auth.user.id).gte("paid_at", start).lt("paid_at", end);
  if (error) return NextResponse.json({ error: "Unable to load revenue" }, { status: 500 });
  const professionalRevenue = (data || []).reduce((sum, row) => sum + row.amount_paid - row.application_fee_amount - row.refunded_amount + row.refunded_application_fee_amount, 0);
  return NextResponse.json({ professionalRevenue });
}
