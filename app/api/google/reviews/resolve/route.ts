import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  GooglePlacesError,
  resolveGoogleBusiness,
} from "@/lib/googlePlaces";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function publicError(error: unknown) {
  if (
    error instanceof GooglePlacesError &&
    (error.code === "invalid_url" || error.code === "not_found")
  ) {
    return {
      message:
        "Ce lien Google Maps n’a pas pu être reconnu. Ouvrez votre fiche dans Google Maps, cliquez sur Partager, puis copiez le lien proposé.",
      status: error.code === "invalid_url" ? 400 : 404,
    };
  }
  return { message: "Impossible de vérifier cette fiche pour le moment.", status: 502 };
}

export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { mapsUrl?: unknown } | null;
    if (typeof body?.mapsUrl !== "string") {
      return NextResponse.json({ error: "Lien Google Maps requis." }, { status: 400 });
    }

    const place = await resolveGoogleBusiness(body.mapsUrl);
    return NextResponse.json(place);
  } catch (error: unknown) {
    console.error("[GOOGLE_REVIEWS_RESOLVE_ERROR]", {
      code: error instanceof GooglePlacesError ? error.code : "unexpected",
    });
    const safe = publicError(error);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
