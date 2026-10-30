import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Retired permanently: historical records and archived documents are retained. */
export async function POST() {
  return NextResponse.json({ error: "Cet ancien service d’envoi mensuel est désactivé." }, {
    status: 410, headers: { "Cache-Control": "private, no-store" },
  });
}
