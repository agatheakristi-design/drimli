import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: unknown };

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });

  // ✅ Important :
  // - en prod (Vercel) => secure:true sinon le cookie peut être ignoré
  // - en local => secure:false
  const isProd = process.env.NODE_ENV === "production";

  res.cookies.set("drimli_at", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 jours
  });

  return res;
}
