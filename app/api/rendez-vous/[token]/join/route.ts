import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthorizedClientMeetUrl } from "@/lib/video/meetUrl";

type Context = {
  params: Promise<{ token: string }> | { token: string };
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function portalRedirect(request: Request, token: string) {
  const response = NextResponse.redirect(
    new URL(`/rendez-vous/${encodeURIComponent(token)}`, request.url),
    303
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request, context: Context) {
  const { token } = await Promise.resolve(context.params);
  if (!token || token.length > 200) return portalRedirect(request, "invalide");

  const { data: appointment, error } = await supabaseAdmin
    .from("appointments")
    .select(
      "status, start_datetime, end_datetime, video_provider, video_join_url, video_room_status"
    )
    .eq("join_token", token)
    .maybeSingle();

  const meetUrl = appointment?.video_room_status === "open"
    ? getAuthorizedClientMeetUrl({
        status: appointment.status,
        startsAt: appointment.start_datetime,
        endsAt: appointment.end_datetime,
        videoProvider: appointment.video_provider,
        videoJoinUrl: appointment.video_join_url,
      })
    : null;

  if (error || !meetUrl) {
    return portalRedirect(request, token);
  }

  const response = NextResponse.redirect(meetUrl, 302);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
