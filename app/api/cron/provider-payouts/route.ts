import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { processProviderPayouts } from "@/lib/providerPayouts";

export const runtime = "nodejs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-12-15.clover" });

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const results = await processProviderPayouts({ admin, stripe });
  return NextResponse.json({ processed: results.length, results });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const { data } = await admin.auth.getUser(token);
  if (!data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = await processProviderPayouts({ admin, stripe, providerId: data.user.id });
  return NextResponse.json({ processed: results.length, results });
}
