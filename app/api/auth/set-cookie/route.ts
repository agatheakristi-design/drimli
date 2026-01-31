import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });

  // ✅ En prod (https), secure doit être true.
  // ✅ En local http://localhost, secure doit être false.
  const isLocalhost =
    typeof req.headers.get("host") === "string" &&
    req.headers.get("host")!.includes("localhost");

  res.cookies.set("drimli_at", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !isLocalhost,
    path: "/",
  });

  return res;
}
