import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData, error: userError } =
    await supabaseAdmin.auth.getUser(token);

  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providerId = userData.user.id;
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("provider_id, slug, full_name, first_name, last_name, published")
    .eq("provider_id", providerId)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "Unable to verify the professional profile." },
      { status: 500 }
    );
  }

  const slug = profile?.slug?.trim() ?? "";
  const hasIdentity = Boolean(
    profile?.full_name?.trim() ||
      (profile?.first_name?.trim() && profile?.last_name?.trim())
  );

  if (!profile || profile.provider_id !== providerId || !slug || !hasIdentity) {
    return NextResponse.json(
      {
        code: "PROFILE_NOT_READY",
        error:
          "Le profil doit contenir une identité et un slug avant publication.",
      },
      { status: 422 }
    );
  }

  if (!profile.published) {
    const { error: publishError } = await supabaseAdmin
      .from("profiles")
      .update({ published: true })
      .eq("provider_id", providerId);

    if (publishError) {
      return NextResponse.json(
        { error: "Unable to publish the professional profile." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ published: true, slug });
}
