import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const providerId = body?.providerId as string | undefined;
    const productId = body?.productId as string | undefined;
    const start = body?.start as string | undefined;
    const end = body?.end as string | undefined;

    const clientEmail = body?.clientEmail as string | undefined;
    const clientPhone = body?.clientPhone as string | undefined;

    if (!providerId || !productId || !start || !end || !clientEmail || !clientPhone) {
      return NextResponse.json(
        { error: "Missing fields. Expected providerId, productId, start, end, clientEmail, clientPhone." },
        { status: 400 }
      );
    }

    if (!isUuid(providerId) || !isUuid(productId)) {
      return NextResponse.json({ error: "providerId/productId must be UUID." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing server env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // (Optionnel mais recommandé) : vérifier que le service existe et correspond au provider
    const { data: product, error: prodErr } = await admin
      .from("products")
      .select("id, provider_id, active")
      .eq("id", productId)
      .maybeSingle<{ id: string; provider_id: string; active: boolean | null }>();

    if (prodErr) {
      return NextResponse.json({ error: prodErr.message }, { status: 400 });
    }
    if (!product || product.active === false || product.provider_id !== providerId) {
      return NextResponse.json({ error: "Service invalid or inactive." }, { status: 400 });
    }

    const { data, error } = await admin
      .from("appointments")
      .insert({
        provider_id: providerId,
        product_id: productId,
        start_datetime: start,
        end_datetime: end,
        status: "pending",
        client_email: clientEmail,
        client_phone: clientPhone,
      })
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ id: data?.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}