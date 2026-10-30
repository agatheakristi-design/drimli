import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildClientDocumentArchive, ExportError } from "@/lib/clientDocumentArchive";
import { accountantMonthlyMail, type AccountantMail } from "@/lib/accountantMonthlyEmail";

export type AccountantDelivery = {
  id: string; provider_id: string; period_month: string; recipient: string; status: string; lease_token: string;
  mail_payload: AccountantMail | null; archive_path: string | null; archive_hash: string | null;
  archive_expires_at: string; link_expires_at: string | null; exported_count: number; missing_documents: string[];
};
export type MonthlySender = (payload: AccountantMail, key: string) => Promise<{ data: { id: string } | null; error: { statusCode?: number | null; name?: string } | null }>;
export const hashAccountantToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const accountantArchivePrefix = (job: Pick<AccountantDelivery, "id" | "provider_id">) => `providers/${job.provider_id}/accountant-monthly/${job.id}/`;
export function isAccountantArchivePath(job: Pick<AccountantDelivery, "id" | "provider_id">, path: string) {
  return path.startsWith(accountantArchivePrefix(job)) && /^[a-f0-9-]{36}\.zip$/.test(path.slice(accountantArchivePrefix(job).length));
}
export function accountantLink(base: string, token: string) {
  const origin = new URL(base);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("invalid canonical app URL");
  return `${origin.origin}/api/accountant-documents/download?token=${token}`;
}
export async function requirePrivateInvoiceBucket(admin: SupabaseClient) {
  const { data, error } = await admin.storage.getBucket("invoices");
  if (error || !data || data.public !== false) throw new Error("private invoice bucket unavailable");
}
async function transition(admin: SupabaseClient, job: AccountantDelivery, action: string, data: Record<string, unknown> = {}) {
  const result = await admin.rpc("transition_accountant_delivery", { p_id: job.id, p_lease: job.lease_token, p_action: action, p_data: data });
  if (result.error || !result.data) throw new Error("delivery transition unavailable");
  return result.data as AccountantDelivery;
}

/** One claimed job only. An accepted/possibly accepted request is never reset blindly. */
export async function processAccountantDelivery(admin: SupabaseClient, claimed: AccountantDelivery, options: {
  baseUrl: string; from: string; send: MonthlySender; signal: AbortSignal;
  preparationAdmin?: SupabaseClient; deadlineAt?: number;
}) {
  let job = claimed;
  const preparationAdmin = options.preparationAdmin || admin;
  const previouslyUncertain = Boolean(claimed.mail_payload);
  let submitting = previouslyUncertain;
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.recipient)) throw new ExportError("invalid_accountant_email", 413);
    await requirePrivateInvoiceBucket(preparationAdmin);
    let payload = job.mail_payload;
    if (!payload) {
      const archive = await buildClientDocumentArchive(preparationAdmin, { providerId: job.provider_id, year: job.period_month.slice(0, 4), month: job.period_month.slice(5, 7), type: "all", signal: options.signal });
      const token = randomBytes(32).toString("hex");
      const link = accountantLink(options.baseUrl, token);
      const path = `${accountantArchivePrefix(job)}${job.lease_token}.zip`;
      const uploaded = await preparationAdmin.storage.from("invoices").upload(path, archive.zip, { contentType: "application/zip", upsert: false });
      if (uploaded.error) throw new Error("private archive upload failed");
      job = await transition(admin, job, "prepared", { archive_path: path, archive_hash: createHash("sha256").update(archive.zip).digest("hex"), archive_bytes: archive.zip.length,
        exported_count: archive.exported, missing_documents: archive.missing, link_token_hash: hashAccountantToken(token) });
      payload = accountantMonthlyMail({ from: options.from, to: job.recipient, period: job.period_month.slice(0, 7), link, missing: archive.missing.length });
    }
    if (options.signal.aborted || (options.deadlineAt != null && Date.now() + 15_000 >= options.deadlineAt)) throw new Error("preparation timeout");
    job = await transition(admin, job, "sending", { payload });
    submitting = true;
    // The SDK does not expose AbortSignal here. A timeout is an UNCERTAIN result,
    // not proof of rejection: the provider may still accept the pending request.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: Awaited<ReturnType<MonthlySender>>;
    try {
      result = await Promise.race([options.send(payload, `accountant-monthly/${job.id}`), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("resend_timeout")), 10_000); })]);
    } finally { clearTimeout(timer); }
    if (result.error || !result.data?.id) {
      const code = result.error?.statusCode;
      const definiteRejection = !previouslyUncertain && code != null && code >= 400 && code < 500 && code !== 409;
      const recorded = await transition(admin, job, definiteRejection ? "failed" : "uncertain", { error: definiteRejection ? "resend_rejected" : "resend_result_uncertain" });
      return { id: job.id, status: recorded.status };
    }
    await transition(admin, job, "sent", { resend_id: result.data.id });
    return { id: job.id, status: "sent" };
  } catch (error) {
    let status = submitting ? "uncertain" : error instanceof ExportError ? error.status === 413 || error.missing ? "blocked" : error.status === 404 ? "empty" : "failed" : "failed";
    try {
      const recorded = await transition(admin, job, status, { error: submitting ? "send_result_or_confirmation_uncertain" : error instanceof ExportError ? error.message : "preparation_or_storage_failed", ...(error instanceof ExportError && error.missing ? { missing_documents: error.missing } : {}) });
      status = recorded.status;
    } catch { /* The durable sending lease remains non-retryable without reconciliation. */ }
    return { id: job.id, status };
  }
}

export async function purgeExpiredAccountantArchives(admin: SupabaseClient, deadlineAt = Date.now() + 30_000) {
  await requirePrivateInvoiceBucket(admin);
  const { data, error } = await admin.from("accountant_monthly_deliveries").select("id, provider_id, archive_path")
    .lt("archive_expires_at", new Date().toISOString()).neq("status", "purged").or(`and(status.neq.preparing,status.neq.sending),lease_until.lt.${new Date().toISOString()}`).order("archive_expires_at", { ascending: true }).limit(20);
  if (error) throw new Error("archive cleanup unavailable");
  let purged = 0;
  for (const row of data || []) {
    if (Date.now() >= deadlineAt) break;
    const claimed = await admin.rpc("claim_accountant_archive_cleanup", { p_id: row.id });
    if (claimed.error) throw new Error("archive cleanup reservation failed");
    if (!claimed.data) continue;
    const prefix = accountantArchivePrefix(row);
    const listed = await admin.storage.from("invoices").list(prefix, { limit: 100 });
    if (listed.error) throw new Error("archive cleanup listing failed");
    const paths = (listed.data || []).map(file => `${prefix}${file.name}`);
    if (paths.some(path => !isAccountantArchivePath(row, path))) throw new Error("unexpected archive path");
    const removed = paths.length ? await admin.storage.from("invoices").remove(paths) : { error: null };
    if (removed.error) throw new Error("archive cleanup failed");
    const result = await admin.rpc("purge_accountant_delivery_archive", { p_id: row.id });
    if (result.error || !result.data) throw new Error("archive cleanup confirmation failed");
    purged++;
  }
  return purged;
}
