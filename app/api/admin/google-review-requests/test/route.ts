import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendGoogleReviewRequestForAppointment } from "@/lib/googleReviewRequestServer";

export const runtime = "nodejs";

const ADMIN_USER_ID = "ac4e5a5f-c81c-4999-abc5-3eeecd9a85aa";
const TEST_APPOINTMENT_ID = "e4fa9123-20b4-4286-bfa1-6123f0d7adab";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function isAuthorizedAdministrator(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) return false;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return !error && data.user?.id === ADMIN_USER_ID;
}

export async function GET(request: Request) {
  if (!(await isAuthorizedAdministrator(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ available: true });
}

export async function POST(request: Request) {
  if (!(await isAuthorizedAdministrator(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendGoogleReviewRequestForAppointment(
      TEST_APPOINTMENT_ID,
      new Date(),
      "admin_test"
    );

    if (result !== "sent") {
      return NextResponse.json(
        { error: "Ce rendez-vous ne remplit plus les conditions d’envoi." },
        { status: 409 }
      );
    }

    return NextResponse.json({ sent: true });
  } catch (error: unknown) {
    console.error("[GOOGLE_REVIEW_REQUEST_ADMIN_ERROR]", {
      appointmentId: TEST_APPOINTMENT_ID,
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "L’envoi du mail de test a échoué." },
      { status: 500 }
    );
  }
}
