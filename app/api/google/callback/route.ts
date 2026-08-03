import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifyState(state: string) {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET!;

  const [payload64, signature] = state.split(".");

  if (!payload64 || !signature) {
    throw new Error("Invalid state");
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(Buffer.from(payload64, "base64url").toString())
    .digest("base64url");

  if (expected !== signature) {
    throw new Error("Invalid signature");
  }

  const payload = JSON.parse(
    Buffer.from(payload64, "base64url").toString()
  );

  if (Date.now() > payload.expiresAt) {
    throw new Error("State expired");
  }

  return payload;
}

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");

    if (!code || !state) {
      return NextResponse.json(
        { error: "Missing code or state" },
        { status: 400 }
      );
    }

    const { userId } = verifyState(state);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);

    const returnedScope = tokens.scope?.trim() ?? "";

    if (!returnedScope.includes("googleapis.com/auth/calendar")) {
      throw new Error(
        "Google Calendar permission was not granted. Reconnect and accept Calendar access."
      );
    }

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: "v2",
    });

    const { data: profile } = await oauth2.userinfo.get();

    const { data: existingIntegration, error: existingError } =
      await supabaseAdmin
        .from("integrations")
        .select("refresh_token")
        .eq("provider_id", userId)
        .eq("provider", "google")
        .maybeSingle();

    if (existingError) {
      throw new Error(
        `Unable to read the existing Google integration: ${existingError.message}`
      );
    }

    const refreshToken =
      tokens.refresh_token ?? existingIntegration?.refresh_token ?? null;

    if (!refreshToken) {
      throw new Error(
        "Google did not provide a refresh token. Revoke the existing Google authorization, then reconnect."
      );
    }

    const { data: storedIntegration, error: integrationError } =
      await supabaseAdmin
        .from("integrations")
        .upsert(
          {
            provider_id: userId,
            provider: "google",
            account_email: profile.email,
            access_token: tokens.access_token,
            refresh_token: refreshToken,
            token_type: tokens.token_type,
            scope: returnedScope,
            expires_at: tokens.expiry_date
              ? new Date(tokens.expiry_date).toISOString()
              : null,
          },
          {
            onConflict: "provider_id,provider",
          }
        )
        .select("scope")
        .maybeSingle();

    if (integrationError) {
      throw new Error(
        `Unable to store the Google integration: ${integrationError.message}`
      );
    }

    if (!storedIntegration?.scope?.includes("googleapis.com/auth/calendar")) {
      throw new Error(
        "Google Calendar permission was granted but could not be stored."
      );
    }

    return NextResponse.redirect(
      new URL("/dashboard?google=connected", request.url)
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Google authentication failed";

    console.error("[GOOGLE_OAUTH_CALLBACK_ERROR]", { message });

    return NextResponse.redirect(
      new URL("/dashboard?google=error", request.url)
    );
  }
}
