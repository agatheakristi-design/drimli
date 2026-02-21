import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isFilled(v?: string | null) {
  return !!(v && v.trim().length > 0);
}

// Lit le token Supabase depuis les cookies (sb-...-auth-token)
function readAccessTokenFromCookie(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  // Il y a souvent 2 cookies: sb-...-auth-token.0 et .1 (chunking)
  // On reconstruit le JSON stocké dans les chunks.
  const parts: string[] = [];
  cookie.split(";").forEach((c) => {
    const s = c.trim();
    const m = s.match(/^(sb-[^=]+-auth-token\.\d+)=(.+)$/);
    if (m) parts.push(decodeURIComponent(m[2]));
  });

  if (parts.length === 0) {
    // parfois cookie non chunké
    const m2 = cookie.match(/sb-[^=]+-auth-token=([^;]+)/);
    if (!m2) return null;
    try {
      const raw = decodeURIComponent(m2[1]);
      const j = JSON.parse(raw);
      return j?.access_token ?? null;
    } catch {
      return null;
    }
  }

  try {
    const raw = parts.join("");
    const j = JSON.parse(raw);
    return j?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const accessToken = readAccessTokenFromCookie(req);
    if (!accessToken) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = userData.user.id;

    // 1) Profil
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("full_name, profession, city, description, stripe_account_id")
      .eq("provider_id", userId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    const profileComplete =
      !!prof &&
      isFilled(prof.full_name) &&
      isFilled(prof.profession) &&
      isFilled(prof.city) &&
      isFilled(prof.description);

    // 2) Paiement (simple)
    const paymentComplete = !!prof?.stripe_account_id;

    // 3) Services
    const { count: prodCount, error: prodErr } = await supabaseAdmin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", userId)
      .eq("active", true);

    if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
    const servicesComplete = (prodCount ?? 0) > 0;

    // 4) Disponibilités
    const { count: availCount, error: availErr } = await supabaseAdmin
      .from("provider_blocks")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", userId);

    if (availErr) return NextResponse.json({ error: availErr.message }, { status: 500 });
    const availabilityComplete = (availCount ?? 0) > 0;

    const doneCount =
      (profileComplete ? 1 : 0) +
      (paymentComplete ? 1 : 0) +
      (servicesComplete ? 1 : 0) +
      (availabilityComplete ? 1 : 0);

    const next =
      !profileComplete
        ? "/dashboard/profile"
        : !paymentComplete
        ? "/paiements"
        : !servicesComplete
        ? "/dashboard/services"
        : !availabilityComplete
        ? "/dashboard/disponibilites"
        : "/dashboard";

    return NextResponse.json({
      profileComplete,
      paymentComplete,
      servicesComplete,
      availabilityComplete,
      doneCount,
      total: 4,
      accountReady: doneCount === 4,
      next,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "unknown" }, { status: 500 });
  }
}
