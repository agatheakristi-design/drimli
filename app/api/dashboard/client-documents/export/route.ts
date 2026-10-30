import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildClientDocumentArchive, ExportError } from "@/lib/clientDocumentArchive";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const signal = AbortSignal.any([controller.signal, request.signal]);
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }) },
    });
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (signal.aborted) throw new ExportError("L’export a pris trop de temps. Réessayez sur une période plus courte.", 504);
    if (authError || !auth.user) return NextResponse.json({ error: "Session expirée." }, { status: 401, headers });
    const params = new URL(request.url).searchParams;
    const year = params.get("year") || "";
    const month = params.get("month") || "all";
    const type = params.get("type") || "all";
    if (!/^\d{4}$/.test(year) || Number(year) < 2000 || !/^(all|0[1-9]|1[0-2])$/.test(month) || !["all", "invoice", "credit_note"].includes(type)) return NextResponse.json({ error: "Période ou type de document invalide." }, { status: 400, headers });
    const { zip, exported, missing } = await buildClientDocumentArchive(admin, { providerId: auth.user.id, year, month, type, signal });
    const filename = `DRIMLI_documents_${year}${month === "all" ? "" : `-${month}`}_${type === "all" ? "factures-avoirs" : type === "invoice" ? "factures" : "avoirs"}.zip`;
    return new Response(new Uint8Array(zip), { headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "X-Documents-Exported": String(exported), "X-Documents-Missing": String(missing.length), "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    const failure = signal.aborted ? new ExportError("L’export a pris trop de temps. Sélectionnez une période plus courte.", 504) : error;
    return NextResponse.json({ error: failure instanceof ExportError ? failure.message : "Export impossible. Réessayez ultérieurement.", ...(failure instanceof ExportError && failure.missing ? { missing: failure.missing } : {}) }, { status: failure instanceof ExportError ? failure.status : 500, headers });
  } finally { clearTimeout(timer); }
}
