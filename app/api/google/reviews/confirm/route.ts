import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchGoogleBusinessPlace,
  GooglePlacesError,
  resolveGoogleBusiness,
} from "@/lib/googlePlaces";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      mapsUrl?: unknown;
      placeId?: unknown;
    } | null;
    if (
      typeof body?.mapsUrl !== "string" &&
      typeof body?.placeId !== "string"
    ) {
      return NextResponse.json({ error: "Fiche Google requise." }, { status: 400 });
    }

    // All display values are fetched again server-side; client values are never trusted.
    const place =
      typeof body.placeId === "string"
        ? await fetchGoogleBusinessPlace(body.placeId)
        : await resolveGoogleBusiness(body.mapsUrl as string);
    const now = new Date().toISOString();
    const { error: saveError } = await supabaseAdmin
      .from("google_business_profiles")
      .upsert(
        {
          provider_id: data.user.id,
          google_place_id: place.placeId,
          google_business_name: place.businessName,
          google_business_address: place.address,
          google_maps_url: place.mapsUrl,
          google_rating: place.rating,
          google_reviews_count: place.reviewsCount,
          google_reviews_enabled: true,
          google_reviews_last_synced_at: now,
          updated_at: now,
        },
        { onConflict: "provider_id" }
      );

    if (saveError) throw saveError;
    return NextResponse.json({ ...place, enabled: true });
  } catch (error: unknown) {
    console.error("[GOOGLE_REVIEWS_CONFIRM_ERROR]", {
      code: error instanceof GooglePlacesError ? error.code : "unexpected",
    });
    const invalid = error instanceof GooglePlacesError && error.code === "invalid_url";
    const notFound = error instanceof GooglePlacesError && error.code === "not_found";
    const status = invalid ? 400 : notFound ? 404 : 502;
    const message =
      invalid || notFound
        ? "Ce lien Google Maps n’a pas pu être reconnu. Ouvrez votre fiche dans Google Maps, cliquez sur Partager, puis copiez le lien proposé."
        : "Impossible d’activer cette fiche pour le moment.";
    return NextResponse.json({ error: message }, { status });
  }
}
