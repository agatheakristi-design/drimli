import type Stripe from "stripe";

export type StripeAccountColumns = {
  stripe_account_id: string | null;
  stripe_connect_account_id: string | null;
};

export function resolveStripeAccountId(profile: StripeAccountColumns) {
  const canonical = profile.stripe_account_id;
  const legacy = profile.stripe_connect_account_id;

  return {
    accountId: canonical ?? legacy,
    needsCanonicalBackfill: !canonical && Boolean(legacy),
    conflict: Boolean(canonical && legacy && canonical !== legacy),
  };
}

export function stripeAccountState(account: Stripe.Account) {
  const transfers = account.capabilities?.transfers ?? null;
  const cardPayments = account.capabilities?.card_payments ?? null;

  return {
    ready: transfers === "active" && account.details_submitted === true,
    detailsSubmitted: account.details_submitted,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    transfers,
    cardPayments,
    currentlyDue: account.requirements?.currently_due ?? [],
  };
}

export async function requestTransfersCapability(
  stripe: Stripe,
  account: Stripe.Account
) {
  if (account.capabilities?.transfers === "active") return account;

  return stripe.accounts.update(account.id, {
    capabilities: {
      transfers: { requested: true },
    },
  });
}
