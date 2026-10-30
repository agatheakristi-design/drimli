import type { SupabaseClient } from "@supabase/supabase-js";
import archiver from "archiver";
import { parisDateTimeToIso } from "@/app/components/calendar/utils";

const MAX_DOCUMENTS = 200;
const MAX_SOURCE_BYTES = 20_000_000;
const MAX_ZIP_BYTES = 4_000_000;
const reducePeriod = "L’export dépasse les limites autorisées (200 documents, ZIP de 4 Mo). Sélectionnez une période plus courte ou un seul type de document.";
export class ExportError extends Error {
  constructor(message: string, readonly status: number, readonly missing?: string[]) { super(message); }
}
type ArchivedDocument = { id: string; number: string; folder: "Factures" | "Avoirs"; bucket: string | null; path: string | null };

async function makeZip(entries: { name: string; data: Buffer }[], signal: AbortSignal) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const fail = (error: Error) => { archive.abort(); reject(error); };
    const abort = () => fail(new ExportError("L’export a pris trop de temps. Sélectionnez une période plus courte.", 504));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    archive.once("end", () => { signal.removeEventListener("abort", abort); resolve(Buffer.concat(chunks)); });
    archive.once("error", error => { signal.removeEventListener("abort", abort); reject(error); });
    archive.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_ZIP_BYTES) { signal.removeEventListener("abort", abort); fail(new ExportError(reducePeriod, 413)); }
      else chunks.push(chunk);
    });
    // Explicit empty folders keep the same layout for every document selection.
    archive.append(Buffer.alloc(0), { name: "Factures/" });
    archive.append(Buffer.alloc(0), { name: "Avoirs/" });
    for (const entry of entries) archive.append(entry.data, { name: entry.name });
    archive.finalize().catch(fail);
  });
}


/** Server-only archive builder: callers must authenticate and resolve providerId. */
export async function buildClientDocumentArchive(admin: SupabaseClient, options: {
  providerId: string; year: string; month: string; type: string; signal: AbortSignal;
}) {
  const { providerId, year, month, type, signal } = options;
  if (!providerId || !/^\d{4}$/.test(year) || Number(year) < 2000 || !/^(all|0[1-9]|1[0-2])$/.test(month) || !["all", "invoice", "credit_note"].includes(type)) throw new ExportError("Période ou type de document invalide.", 400);
  const first = `${year}-${month === "all" ? "01" : month}-01`;
  const nextPeriod = new Date(Date.UTC(Number(year), month === "all" ? 12 : Number(month), 1)).toISOString().split("T")[0];
  const start = parisDateTimeToIso(first, "00:00");
  const end = parisDateTimeToIso(nextPeriod, "00:00");
  const documents: ArchivedDocument[] = [];
  for (const kind of ["invoice", "credit_note"] as const) {
    if (type !== "all" && type !== kind) continue;
    const table = kind === "invoice" ? "client_invoices" : "client_credit_notes";
    const numberColumn = kind === "invoice" ? "invoice_number" : "credit_note_number";
    // Read all pages of this period, independently of the dashboard pagination.
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await admin.from(table).select(`id, ${numberColumn}, storage_bucket, file_path`)
        .eq("provider_id", providerId).gte("issued_at", start).lt("issued_at", end)
        .order("issued_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 99);
      if (signal.aborted) throw new ExportError("L’export a pris trop de temps. Sélectionnez une période plus courte.", 504);
      if (error) throw new ExportError("Impossible de lire les documents. Réessayez ultérieurement.", 500);
      for (const row of data || []) {
        documents.push({ id: row.id, number: String(row[numberColumn as keyof typeof row]), folder: kind === "invoice" ? "Factures" : "Avoirs", bucket: row.storage_bucket, path: row.file_path });
      }
      if (documents.length > MAX_DOCUMENTS) throw new ExportError(reducePeriod, 413);
      if (!data || data.length < 100) break;
    }
  }
  if (!documents.length) throw new ExportError("Aucun document pour la période et le type sélectionnés.", 404);
  const missing: string[] = [];
  const entries: { name: string; data: Buffer }[] = [];
  const names = new Set<string>();
  let sourceBytes = 0;
  for (const document of documents) {
    if (signal.aborted) throw new ExportError("L’export a pris trop de temps. Sélectionnez une période plus courte.", 504);
    const label = `${document.folder} — ${document.number.replace(/[\r\n\t]/g, " ")} (${document.id})`;
    if (!document.bucket || !document.path) { missing.push(`${label} : PDF non archivé.`); continue; }
    // Only metadata read from owned document rows supplies the storage location.
    const { data: pdf, error } = await admin.storage.from(document.bucket).download(document.path);
    if (signal.aborted) throw new ExportError("L’export a pris trop de temps. Sélectionnez une période plus courte.", 504);
    if (error || !pdf) {
      const code = error && "statusCode" in error ? String(error.statusCode) : "";
      if (code === "404" || (error && /not found|does not exist/i.test(error.message))) { missing.push(`${label} : fichier PDF introuvable.`); continue; }
      throw new ExportError("Un document ne peut pas être récupéré. Réessayez ultérieurement ; aucun export incomplet n’a été créé.", 502);
    }
    sourceBytes += pdf.size;
    if (sourceBytes > MAX_SOURCE_BYTES) throw new ExportError(reducePeriod, 413);
    const safeNumber = document.number.normalize("NFKC").replace(/[^\p{L}\p{N}._-]/gu, "_").replace(/^\.+/, "").slice(0, 120) || "document";
    let name = `${document.folder}/${safeNumber}.pdf`;
    let suffix = 1;
    while (names.has(name.toLowerCase())) { name = `${document.folder}/${safeNumber}_${suffix++}.pdf`; }
    names.add(name.toLowerCase());
    entries.push({ name, data: Buffer.from(await pdf.arrayBuffer()) });
  }
  if (!entries.length) throw new ExportError("Aucun PDF archivé disponible pour cette sélection.", 404, missing);
  const exported = entries.length;
  if (missing.length) entries.push({ name: "Documents-manquants.txt", data: Buffer.from(`Export DRIMLI ${year}${month === "all" ? "" : `-${month}`}\n${exported} PDF inclus. ${missing.length} PDF manquants.\nAucun document n’a été régénéré.\n\n${missing.join("\n")}\n`, "utf8") });
  const zip = await makeZip(entries, signal);
  return { zip, exported, missing };
}
