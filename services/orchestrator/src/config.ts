import "dotenv/config";
import type { Network } from "@x402/core/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  hederaAccountId: requireEnv("HEDERA_ACCOUNT_ID"),
  hederaPrivateKey: requireEnv("HEDERA_PRIVATE_KEY"),
  hederaNetwork: (process.env.HEDERA_NETWORK ?? "hedera:testnet") as Network,
  resourceServerUrl: process.env.RESOURCE_SERVER_URL ?? "http://localhost:4001",
  port: Number(process.env.PORT ?? 4002),

  privyAppId: requireEnv("PRIVY_APP_ID"),
  privyAppSecret: requireEnv("PRIVY_APP_SECRET"),
  /** Set once by `pnpm privy:setup-policy`, then pasted into .env. */
  privyRespondentPolicyId: process.env.PRIVY_RESPONDENT_POLICY_ID,

  worldAppId: requireEnv("WORLD_APP_ID"),
  worldRpId: requireEnv("WORLD_RP_ID"),
  worldSigningKey: requireEnv("WORLD_SIGNING_KEY"),
  /** "sandbox" while Selfie Check access is pending/being tested, "production" once live. */
  worldEnvironment: (process.env.WORLD_ENVIRONMENT ?? "sandbox") as "production" | "staging" | "sandbox",

  /** From resend.com/api-keys. */
  resendApiKey: requireEnv("RESEND_API_KEY"),
  /** resend.dev's shared test sender works with no domain verification; switch once a real domain is verified. */
  claimEmailFrom: process.env.CLAIM_EMAIL_FROM ?? "FormDrop <onboarding@resend.dev>",
  /** apps/web base URL — the claim link points here. */
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:3000",

  /** Set once by `pnpm hcs:setup-topic`, then pasted into .env. */
  hcsAuditTopicId: process.env.HCS_AUDIT_TOPIC_ID,

  /** Test-mode secret key from dashboard.stripe.com/test/apikeys — no billing needed. */
  stripeSecretKey: requireEnv("STRIPE_SECRET_KEY"),
  /** From the webhook endpoint's signing secret (dashboard, or `stripe listen`'s printed secret while developing). */
  stripeWebhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
  /**
   * Nominal USD-cents-per-HBAR peg used only to price the card-funding
   * checkout — testnet HBAR has no real value, so this exists purely to
   * make "pay with a card" a coherent amount to charge. Not a real exchange rate.
   */
  usdCentsPerHbar: Number(process.env.USD_CENTS_PER_HBAR ?? 100),
};
