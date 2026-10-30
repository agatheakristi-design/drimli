import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { isAccountantMonthlyWindow, previousAccountantMonth } from "@/lib/accountantMonthlySchedule";
import { accountantLink, hashAccountantToken, isAccountantArchivePath, processAccountantDelivery, purgeExpiredAccountantArchives, requirePrivateInvoiceBucket, type AccountantDelivery } from "@/lib/accountantMonthlyDelivery";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const enabled = () => process.env.ACCOUNTANT_MONTHLY_ENABLED === "true";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const canonical = () => process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
function adminFor(request: Request, timeoutMs = 45_000, fetchTimeoutMs = timeoutMs) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(fetchTimeoutMs), ...(init?.signal ? [init.signal] : [])]) }) },
  });
  return { admin, signal };
}
const isCron = (request: Request) => Boolean(process.env.CRON_SECRET) && request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;

function continueAfterResponse(pending: number) {
  after(async () => {
    try {
      const response = await fetch(new URL("/api/cron/accountant-monthly/continue", canonical()), {
        method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) console.error("[ACCOUNTANT_MONTHLY_CONTINUATION_FAILED]", { status: response.status });
    } catch { console.error("[ACCOUNTANT_MONTHLY_CONTINUATION_FAILED]", { pending }); }
  });
}

export async function accountantCron(request: Request) {
  if (!isCron(request)) return json({ error: "Unauthorized" }, 401);
  if (!enabled()) return json({ enabled: false });
  const automatic = request.method === "GET";
  const now = new Date();
  if (automatic && !isAccountantMonthlyWindow(now)) return json({ skipped: "outside_paris_monthly_window" });
  try {
    // Preparation must stop at 25s; journal writes retain a separate budget.
    // At most one dossier/invocation: 25s prep + <=10s Resend + bounded SQL
    // leaves time for confirmation and the next HTTP continuation before 60s.
    const startedAt = Date.now();
    const { admin } = adminFor(request, 50_000, 5_000);
    const { admin: preparationAdmin, signal } = adminFor(request, 25_000);
    const body = automatic ? {} : await request.json().catch(() => null);
    if (!body || (!automatic && !["continue", "retry", "reconcile"].includes(body.action))) return json({ error: "Action invalide." }, 400);
    if (!process.env.RESEND_FROM) return json({ error: "Expéditeur de production non configuré." }, 503);
    accountantLink(canonical(), "configuration-check");
    if (automatic) {
      const queued = await admin.rpc("queue_accountant_month", { p_period: `${previousAccountantMonth(now)}-01` });
      if (queued.error) throw new Error("queue unavailable");
    }
    const { sendAccountantMonthlyDocuments, getAccountantMonthlyEmail } = await import("@/lib/email");
    if (body.action === "reconcile") {
      if (typeof body.id !== "string" || !uuid.test(body.id) || typeof body.resendId !== "string" || !uuid.test(body.resendId)) return json({ error: "Identifiants requis." }, 400);
      const stored = await admin.from("accountant_monthly_deliveries").select("id, mail_payload, status").eq("id", body.id).maybeSingle();
      if (stored.error || !stored.data?.mail_payload) return json({ error: "Envoi introuvable." }, 404);
      const accepted = await getAccountantMonthlyEmail(body.resendId);
      const payload = stored.data.mail_payload;
      const email = accepted.data;
      if (accepted.error || !email || email.to.length !== 1 || email.to[0] !== payload.to || email.subject !== payload.subject || email.text !== payload.text || email.html !== payload.html || email.from !== payload.from) return json({ error: "La preuve Resend ne correspond pas à cet envoi." }, 409);
      const result = await admin.rpc("reconcile_accountant_delivery", { p_id: body.id, p_resend_id: email.id });
      if (result.error || !result.data) return json({ error: "Réconciliation refusée." }, 409);
      return json({ reconciled: true });
    }
    if (body.action === "retry" && (typeof body.id !== "string" || !uuid.test(body.id))) return json({ error: "Identifiant requis." }, 400);
    const results: { id: string; status: string }[] = [];
    if (!signal.aborted) {
      const claimed = await admin.rpc("claim_accountant_delivery", { p_id: body.action === "retry" ? body.id : null, p_retry: body.action === "retry" });
      if (claimed.error) throw new Error("claim unavailable");
      if (claimed.data?.id) results.push(await processAccountantDelivery(admin, claimed.data as AccountantDelivery, { signal, preparationAdmin, deadlineAt: startedAt + 50_000, baseUrl: canonical(), from: process.env.RESEND_FROM,
        send: (payload, key) => sendAccountantMonthlyDocuments(payload, key) }));
    }
    const pending = await admin.from("accountant_monthly_deliveries").select("id", { count: "exact", head: true })
      .lt("attempts", 10).or(`status.eq.pending,and(status.eq.preparing,mail_payload.is.null,lease_until.lt.${new Date().toISOString()})`);
    if (pending.error) throw new Error("remaining queue unavailable");
    if (pending.count && body.action !== "retry") continueAfterResponse(pending.count);
    return json({ results, pending: pending.count || 0, continuationRequired: Boolean(pending.count), ...(!results.length && body.action === "retry" ? { skipped: "already_sent_locked_or_reconciliation_required" } : {}) }, pending.count ? 202 : 200);
  } catch {
    return json({ error: "Traitement interrompu. Consulter le journal des envois avant toute relance." }, 503);
  }
}

/** Acknowledge before starting the next bounded batch, avoiding a chain of held HTTP responses. */
export async function accountantContinuation(request: Request) {
  if (!isCron(request)) return json({ error: "Unauthorized" }, 401);
  if (!enabled()) return json({ enabled: false });
  after(async () => {
    const response = await accountantCron(new Request(new URL("/api/cron/accountant-monthly", canonical()), {
      method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "continue" }),
    }));
    if (!response.ok) console.error("[ACCOUNTANT_MONTHLY_BATCH_FAILED]", { status: response.status });
  });
  return json({ accepted: true }, 202);
}

export async function accountantCleanup(request: Request) {
  if (!isCron(request)) return json({ error: "Unauthorized" }, 401);
  if (!enabled()) return json({ enabled: false });
  try {
    const { admin } = adminFor(request, 50_000, 5_000);
    // This daily maintenance entry also wakes the durable queue after a lost
    // continuation/crashed worker. No new period is queued, and uncertain emails
    // are never automatically resubmitted. Scheduling remains separately gated.
    const recovered = await admin.rpc("recover_accountant_deliveries");
    if (recovered.error) throw new Error("recovery unavailable");
    if (recovered.data) continueAfterResponse(recovered.data);
    return json({ purged: await purgeExpiredAccountantArchives(admin, Date.now() + 30_000), ready: recovered.data || 0 });
  }
  catch { return json({ error: "Nettoyage interrompu ; les PDF sources sont conservés." }, 503); }
}

/** Bearer link: never accepts a provider ID, bucket or storage path from the URL. */
export async function accountantDownload(request: Request) {
  if (!enabled()) return json({ error: "Service indisponible." }, 503);
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return json({ error: "Lien indisponible." }, 404);
  try {
    const { admin } = adminFor(request);
    const stored = await admin.from("accountant_monthly_deliveries").select("id, provider_id, recipient, status, archive_path, archive_expires_at, link_expires_at")
      .eq("link_token_hash", hashAccountantToken(token)).maybeSingle();
    if (stored.error) throw new Error("lookup unavailable");
    const job = stored.data;
    if (!job || !["sending", "uncertain", "sent"].includes(job.status)) return json({ error: "Lien indisponible." }, 404);
    if (!job.link_expires_at || Date.parse(job.link_expires_at) <= Date.now() || Date.parse(job.archive_expires_at) <= Date.now()) return new Response("Ce lien a expiré. Demandez au professionnel de renouveler le lien depuis sa rubrique Factures. Si l’archive a été supprimée, il peut vous transmettre les PDF archivés depuis cette même rubrique.", { status: 410, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
    const profile = await admin.from("profiles").select("accountant_email").eq("provider_id", job.provider_id).maybeSingle();
    if (profile.error) throw new Error("recipient check unavailable");
    if (!profile.data?.accountant_email?.trim() || profile.data.accountant_email.trim() !== job.recipient || !job.archive_path || !isAccountantArchivePath(job, job.archive_path)) return json({ error: "Lien indisponible." }, 404);
    await requirePrivateInvoiceBucket(admin);
    // Recompute after all lookups, leaving one second for rounding. Validate the
    // actual server-generated JWT expiry too: signing latency must not extend
    // access beyond either absolute cutoff. Never return an overlong grant.
    const cutoff = Math.floor(Math.min(Date.parse(job.link_expires_at!), Date.parse(job.archive_expires_at)) / 1000);
    const seconds = Math.min(300, cutoff - Math.ceil(Date.now() / 1000) - 1);
    if (!Number.isFinite(seconds) || seconds < 1) return json({ error: "Ce lien a expiré. Demandez son renouvellement au professionnel." }, 410);
    const signed = await admin.storage.from("invoices").createSignedUrl(job.archive_path, seconds);
    if (signed.error || !signed.data?.signedUrl) throw new Error("download unavailable");
    const signedToken = new URL(signed.data.signedUrl).searchParams.get("token");
    const expiry: unknown = signedToken ? JSON.parse(Buffer.from(signedToken.split(".")[1] || "", "base64url").toString("utf8")).exp : null;
    if (typeof expiry !== "number" || !Number.isFinite(expiry) || expiry > cutoff || expiry <= Date.now() / 1000) throw new Error("invalid signed expiry");
    return new Response(null, { status: 302, headers: { ...headers, Location: signed.data.signedUrl } });
  } catch { return json({ error: "Téléchargement indisponible. Réessayez ultérieurement." }, 503); }
}

export async function accountantLinks(request: Request) {
  if (!enabled()) return json({ enabled: false, error: "L’envoi mensuel n’est pas activé." }, 503);
  try {
    const { admin } = adminFor(request);
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: auth, error } = await admin.auth.getUser(token);
    if (error || !auth.user) return json({ error: "Session expirée." }, 401);
    if (request.method === "GET") {
      const result = await admin.from("accountant_monthly_deliveries").select("id, period_month, status, sent_at, link_expires_at, archive_expires_at")
        .eq("provider_id", auth.user.id).in("status", ["sent", "purged"]).order("period_month", { ascending: false }).limit(12);
      if (result.error) throw new Error("history unavailable");
      return json({ deliveries: result.data || [] });
    }
    const body = await request.json().catch(() => null);
    if (typeof body?.id !== "string" || !uuid.test(body.id)) return json({ error: "Document invalide." }, 400);
    // Recheck ownership in SQL as well; no caller-supplied provider is trusted.
    const tokenValue = randomBytes(32).toString("hex");
    const link = accountantLink(canonical(), tokenValue);
    await requirePrivateInvoiceBucket(admin);
    const renewed = await admin.rpc("renew_accountant_delivery_link", { p_id: body.id, p_provider: auth.user.id, p_hash: hashAccountantToken(tokenValue) });
    if (renewed.error || !renewed.data) return json({ error: "Renouvellement impossible : archive expirée ou adresse du comptable modifiée. Vous pouvez utiliser le téléchargement ZIP habituel." }, 409);
    return json({ url: link, expiresAt: renewed.data });
  } catch { return json({ error: "Opération indisponible." }, 503); }
}
