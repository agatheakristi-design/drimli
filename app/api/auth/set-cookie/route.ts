import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });

  res.cookies.set("drimli_at", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // localhost
    path: "/",
  });

  return res;
}
