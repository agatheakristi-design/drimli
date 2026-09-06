import type Stripe from "stripe";

export type DrimliPayoutMode = "automatic" | "manual";

export async function setConnectedAccountPayoutMode(
  stripe: Stripe,
  accountId: string,
  mode: DrimliPayoutMode
) {
  await stripe.balanceSettings.update(
    {
      payments: {
        payouts: {
          schedule: { interval: mode === "manual" ? "manual" : "daily" },
        },
      },
    },
    { stripeAccount: accountId }
  );
}
