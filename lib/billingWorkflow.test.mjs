import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const webhook = await readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
const migration = await readFile(
  new URL("../supabase/migrations/20260812120000_harden_billing_foundation.sql", import.meta.url),
  "utf8"
);
const completionMigration = await readFile(
  new URL("../supabase/migrations/20260812150000_complete_client_billing_documents.sql", import.meta.url),
  "utf8"
);

test("paid status is checked before accounting", () => {
  assert.ok(webhook.includes('session.payment_status !== "paid"'));
});

test("payment and invoice are persisted before Meet and confirmation email", () => {
  const payment = webhook.indexOf('.from("drimli_payments")');
  const invoice = webhook.indexOf('.from("client_invoices")');
  const meet = webhook.indexOf("createGoogleMeetAppointment", webhook.indexOf("export async function POST"));
  const email = webhook.indexOf("sendAppointmentConfirmationEmail", webhook.indexOf("export async function POST"));
  assert.ok(payment > 0 && invoice > payment && meet > invoice && email > meet);
});

test("webhook and accounting records have unique idempotency guards", () => {
  assert.ok(webhook.includes('"claim_stripe_webhook_event"'));
  assert.match(migration, /stripe_checkout_session_id text not null unique/);
  assert.match(migration, /stripe_payment_intent_id text not null unique/);
});

test("invoice amount comes from the paid Stripe session", () => {
  assert.ok(webhook.includes("total_including_tax: session.amount_total"));
  assert.ok(webhook.includes("totalIncludingTax: clientInvoice.total_including_tax"));
});

test("invoice numbers are allocated in the same transaction as the invoice row", () => {
  const functionBody = completionMigration.slice(
    completionMigration.indexOf("create_paid_client_invoice"),
    completionMigration.indexOf("create table public.client_credit_notes")
  );
  assert.ok(functionBody.includes("next_client_invoice_number"));
  assert.ok(functionBody.includes("insert into public.client_invoices"));
});

test("new client invoices require an opaque token", () => {
  assert.ok(completionMigration.includes("client_download_token_hash"));
  assert.ok(webhook.includes("client_download_token_hash: billingSnapshot.client_download_token_hash"));
});
