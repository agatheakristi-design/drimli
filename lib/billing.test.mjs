import assert from "node:assert/strict";
import test from "node:test";
import {
  DRIMLI_COMMISSION_RATE,
  calculateDrimliFee,
  calculateTaxBreakdown,
  refundDestinationChargePolicy,
  cancellationRefundAmount,
} from "./billing.ts";

test("100 EUR produces a 5 EUR application fee and 95 EUR provider share", () => {
  assert.equal(DRIMLI_COMMISSION_RATE, 0.05);
  assert.equal(calculateDrimliFee(10_000), 500);
  assert.equal(10_000 - calculateDrimliFee(10_000), 9_500);
});

test("cancellation policy never blocks a voluntary full or partial refund", () => {
  assert.equal(cancellationRefundAmount("full", 5_000), 5_000);
  assert.equal(cancellationRefundAmount("partial", 5_000, 2_000), 2_000);
});

test("cancelling without a refund produces no Stripe refund amount", () => {
  assert.equal(cancellationRefundAmount("none", 5_000), null);
});

test("franchise base keeps TTC equal to HT and supplies the legal mention", () => {
  assert.deepEqual(calculateTaxBreakdown(10_000, "franchise_base", null), {
    totalExcludingTax: 10_000,
    vatAmount: 0,
    vatRate: 0,
    vatExemptionMention: "TVA non applicable, art. 293 B du CGI",
  });
});

test("standard VAT is calculated from the amount actually paid", () => {
  assert.deepEqual(calculateTaxBreakdown(12_000, "standard", 0.2), {
    totalExcludingTax: 10_000,
    vatAmount: 2_000,
    vatRate: 0.2,
    vatExemptionMention: null,
  });
});

test("refund reverses the transfer while Drimli keeps its application fee", () => {
  assert.deepEqual(refundDestinationChargePolicy(10_000), {
    amount: 10_000,
    reverse_transfer: true,
  });
});

test("invoice calculations use the paid snapshot even if a service price changes", () => {
  const paidAmount = 10_000;
  const laterServicePrice = 15_000;
  assert.equal(calculateTaxBreakdown(paidAmount, "franchise_base", null).totalExcludingTax, 10_000);
  assert.notEqual(paidAmount, laterServicePrice);
});
