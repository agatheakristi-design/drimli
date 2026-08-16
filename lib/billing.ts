export const DRIMLI_COMMISSION_RATE = 0.05;

export function calculateDrimliFee(amountCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Invalid payment amount");
  }
  return Math.round(amountCents * DRIMLI_COMMISSION_RATE);
}

export function calculateTaxBreakdown(
  totalIncludingTax: number,
  vatRegime: "franchise_base" | "standard",
  vatRate: number | null
) {
  if (!Number.isInteger(totalIncludingTax) || totalIncludingTax <= 0) {
    throw new Error("Invalid invoice amount");
  }

  if (vatRegime === "franchise_base") {
    return {
      totalExcludingTax: totalIncludingTax,
      vatAmount: 0,
      vatRate: 0,
      vatExemptionMention: "TVA non applicable, art. 293 B du CGI",
    };
  }

  if (vatRate === null || !Number.isFinite(vatRate) || vatRate <= 0 || vatRate > 1) {
    throw new Error("A valid VAT rate is required");
  }

  const totalExcludingTax = Math.round(totalIncludingTax / (1 + vatRate));
  return {
    totalExcludingTax,
    vatAmount: totalIncludingTax - totalExcludingTax,
    vatRate,
    vatExemptionMention: null,
  };
}

export function refundDestinationChargePolicy(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid refund amount");
  return {
    amount,
    reverse_transfer: true as const,
    refund_application_fee: true as const,
  };
}

export function cancellationRefundAmount(
  choice: "full" | "partial" | "none",
  remainingAmount: number,
  partialAmount?: number
) {
  if (choice === "none") return null;
  if (choice === "full") return remainingAmount;
  if (!Number.isInteger(partialAmount) || partialAmount! <= 0 || partialAmount! >= remainingAmount) {
    throw new Error("Invalid partial refund amount");
  }
  return partialAmount!;
}
