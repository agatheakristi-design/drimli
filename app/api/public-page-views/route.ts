import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function isValidSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    (origin && origin !== new URL(request.url).origin) ||
    (fetchSite && fetchSite !== "same-origin")
  ) {
    return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  }

  let slug: string;
  try {
    const body = (await request.json()) as { slug?: unknown };
    if (!isValidSlug(body.slug)) {
      return NextResponse.json({ error: "Page introuvable." }, { status: 400 });
    }
    slug = body.slug;
  } catch {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("provider_id")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle<{ provider_id: string }>();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Page introuvable." }, { status: 404 });
  }

  const { error: incrementError } = await supabaseAdmin.rpc(
    "increment_professional_page_view",
    { p_provider_id: profile.provider_id }
  );

  if (incrementError) {
    return NextResponse.json({ error: "Comptage indisponible." }, { status: 503 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
