import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { VideoRoomStatus } from "@/lib/video/types";

type Context = {
  params: Promise<{ id: string }> | { id: string };
};

const ALLOWED_STATUSES = new Set<VideoRoomStatus>([
  "closed",
  "open",
  "locked",
]);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function response(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function isAllowedTransition(
  current: VideoRoomStatus,
  requested: VideoRoomStatus
) {
  if (current === requested) return true;
  if (current === "closed") return requested === "open";
  if (current === "open") return requested === "locked";
  return false;
}

export async function PATCH(request: Request, context: Context) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;

  if (!accessToken) return response("Non autorisé.", 401);

  const { data: userData, error: userError } =
    await supabaseAdmin.auth.getUser(accessToken);
  if (userError || !userData.user) return response("Non autorisé.", 401);

  let requestedStatus: VideoRoomStatus;
  try {
    const body = (await request.json()) as { status?: unknown };
    if (
      typeof body.status !== "string" ||
      !ALLOWED_STATUSES.has(body.status as VideoRoomStatus)
    ) {
      return response("État de salle invalide.", 400);
    }
    requestedStatus = body.status as VideoRoomStatus;
  } catch {
    return response("Requête invalide.", 400);
  }

  const { id } = await Promise.resolve(context.params);
  if (!id) return response("Rendez-vous introuvable.", 404);

  const { data: appointment, error: appointmentError } = await supabaseAdmin
    .from("appointments")
    .select("provider_id, status, video_room_status")
    .eq("id", id)
    .maybeSingle<{
      provider_id: string;
      status: string | null;
      video_room_status: VideoRoomStatus;
    }>();

  if (appointmentError || !appointment) {
    return response("Rendez-vous introuvable.", 404);
  }
  if (appointment.provider_id !== userData.user.id) {
    return response("Non autorisé.", 403);
  }
  if (appointment.status !== "confirmed") {
    return response("Ce rendez-vous n’est pas confirmé.", 409);
  }
  if (!isAllowedTransition(appointment.video_room_status, requestedStatus)) {
    return response("Cette transition de salle n’est pas autorisée.", 409);
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("appointments")
    .update({ video_room_status: requestedStatus })
    .eq("id", id)
    .eq("provider_id", userData.user.id)
    .eq("video_room_status", appointment.video_room_status)
    .select("video_room_status")
    .maybeSingle<{ video_room_status: VideoRoomStatus }>();

  if (updateError || !updated) {
    return response("La salle n’a pas pu être mise à jour.", 409);
  }

  return NextResponse.json({ status: updated.video_room_status });
}
