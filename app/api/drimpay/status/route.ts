import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20" as any,
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");

  if (!accountId) {
    return Response.json({ error: "missing account_id" }, { status: 400 });
  }

  try {
    const acct = await stripe.accounts.retrieve(accountId);

    const transfers = (acct.capabilities as any)?.transfers ?? null;

    return Response.json({
      account_id: acct.id,
      charges_enabled: acct.charges_enabled,
      payouts_enabled: acct.payouts_enabled,
      transfers,
      details_submitted: (acct as any).details_submitted ?? null,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "stripe_error" }, { status: 500 });
  }
}
