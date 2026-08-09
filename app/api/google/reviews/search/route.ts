import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  GooglePlacesError,
  searchGoogleBusinesses,
} from "@/lib/googlePlaces";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;
    if (!token) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      query?: unknown;
    } | null;
    if (typeof body?.query !== "string" || body.query.trim().length < 2) {
      return NextResponse.json(
        { error: "Saisissez un nom ou une adresse." },
        { status: 400 }
      );
    }

    const places = await searchGoogleBusinesses(body.query);
    return NextResponse.json({ places });
  } catch (error: unknown) {
    console.error("[GOOGLE_REVIEWS_SEARCH_ERROR]", {
      code: error instanceof GooglePlacesError ? error.code : "unexpected",
    });
    const notFound =
      error instanceof GooglePlacesError && error.code === "not_found";
    return NextResponse.json(
      {
        error: notFound
          ? "Aucune fiche Google n’a été trouvée."
          : "La recherche Google est indisponible pour le moment.",
      },
      { status: notFound ? 404 : 502 }
    );
  }
}
