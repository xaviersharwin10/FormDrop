import Stripe from "stripe";
import { config } from "./config.js";

const stripe = new Stripe(config.stripeSecretKey);

/**
 * Nominal conversion only — testnet HBAR has no real monetary value, so
 * this peg exists purely to give the card-funding flow a coherent USD
 * amount to charge. See config.ts.
 */
export function tinybarToUsdCents(tinybar: string): number {
  const hbar = Number(BigInt(tinybar)) / 1e8;
  return Math.round(hbar * config.usdCentsPerHbar);
}

/**
 * Real card-payment path for funding a pot, alongside the existing
 * send-testnet-HBAR-yourself path (hederaMirror.ts) — the brief's "card or
 * crypto in" funding model, both actually built rather than one described
 * and one shipped. On success, the webhook below marks the form funded;
 * the treasury itself is unchanged — it's still the orchestrator's own
 * Hedera operator account, topped up via the testnet faucet as needed.
 */
export async function createFundingCheckoutSession(
  formId: string,
  potTinybar: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const amountCents = tinybarToUsdCents(potTinybar);
  if (amountCents < 50) {
    throw new Error("Funding amount is below Stripe's 50-cent minimum charge");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: `FormDrop payout pot — form ${formId}`,
            description: "Funds the payout pot; respondents are paid out in testnet HBAR.",
          },
        },
      },
    ],
    metadata: { formId, potTinybar },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL");
  }
  return session.url;
}

export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
}
