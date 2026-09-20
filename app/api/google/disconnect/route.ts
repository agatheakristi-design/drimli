import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  const reply = (data: object, status = 200) =>
    NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!bearer) return reply({ error: "Vous devez être connecté." }, 401);

    const { data: auth, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !auth.user) return reply({ error: "Vous devez être connecté." }, 401);

    const { data: integration, error: readError } = await admin
      .from("integrations")
      .select("refresh_token, access_token")
      .eq("provider_id", auth.user.id)
      .eq("provider", "google")
      .maybeSingle();
    if (readError) return reply({ error: "Impossible de lire la connexion Google. Réessayez." }, 500);

    const token = integration?.refresh_token || integration?.access_token;
    let revoked = !token;
    if (token) {
      try {
        const response = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        });
        revoked = response.ok;
      } catch {
        // Never log the request/error: it may contain OAuth credentials.
        // Remote failure must not prevent local credential deletion.
      }
    }

    const { error: deleteError } = await admin.from("integrations")
      .delete()
      .eq("provider_id", auth.user.id)
      .eq("provider", "google");
    if (deleteError) return reply({ error: "La suppression locale a échoué. Réessayez la déconnexion." }, 500);

    return reply({ connected: false, remoteRevocation: revoked ? "complete" : "unconfirmed" });
  } catch {
    return reply({ error: "Impossible de déconnecter Google. Réessayez." }, 500);
  }
}
