import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return NextResponse.json(
        { error: "Missing bearer token" },
        { status: 401 }
      );
    }

    const { data: userData, error: userError } =
      await supabaseAdmin.auth.getUser(token);

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("integrations")
      .select("account_email, refresh_token, scope")
      .eq("provider_id", userData.user.id)
      .eq("provider", "google")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const hasRefreshToken = Boolean(data?.refresh_token);
    const hasCalendarScope = Boolean(
      data?.scope?.includes("googleapis.com/auth/calendar")
    );

    const reason = !data
      ? "not_connected"
      : !hasRefreshToken
        ? "refresh_token_missing"
        : !hasCalendarScope
          ? "calendar_scope_missing"
          : null;

    return NextResponse.json({
      connected: hasRefreshToken && hasCalendarScope,
      reason,
      email: data?.account_email ?? null,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
