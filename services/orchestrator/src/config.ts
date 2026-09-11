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
  /** Supabase (or any) Postgres connection string. Replaces the in-memory *Store.ts placeholders. */
  databaseUrl: requireEnv("DATABASE_URL"),

  hederaAccountId: requireEnv("HEDERA_ACCOUNT_ID"),
  hederaPrivateKey: requireEnv("HEDERA_PRIVATE_KEY"),
  hederaNetwork: (process.env.HEDERA_NETWORK ?? "hedera:testnet") as Network,
  resourceServerUrl: process.env.RESOURCE_SERVER_URL ?? "http://localhost:4001",
  port: Number(process.env.PORT ?? 4002),

  privyAppId: requireEnv("PRIVY_APP_ID"),
  privyAppSecret: requireEnv("PRIVY_APP_SECRET"),
  /** Set once by `pnpm privy:setup-policy`, then pasted into .env. */
  privyRespondentPolicyId: process.env.PRIVY_RESPONDENT_POLICY_ID,
  /**
   * Both set once by `pnpm privy:setup-creator-authorization-key`, then
   * pasted into .env. The creator pot-funding wallet's `owner_id` is this
   * key quorum — a single P-256 authorization key we hold — so every
   * mutating request against it (including the secp256k1_sign RPC used to
   * fund a pot) must carry a `privy-authorization-signature` computed with
   * this private key, not just our app secret. Unlike a Privy *policy*
   * (which can't name secp256k1_sign as a method — see
   * privyCreatorWallet.ts), this is a real, separate control.
   */
  privyCreatorKeyQuorumId: process.env.PRIVY_CREATOR_KEY_QUORUM_ID,
  /** Base64-encoded PKCS8 P-256 private key, no PEM headers. */
  privyCreatorAuthorizationPrivateKey: process.env.PRIVY_CREATOR_AUTHORIZATION_PRIVATE_KEY,

  worldAppId: requireEnv("WORLD_APP_ID"),
  worldRpId: requireEnv("WORLD_RP_ID"),
  worldSigningKey: requireEnv("WORLD_SIGNING_KEY"),
  /** "sandbox" while Selfie Check access is pending/being tested, "production" once live. */
  worldEnvironment: (process.env.WORLD_ENVIRONMENT ?? "sandbox") as "production" | "staging" | "sandbox",

  /**
   * Gmail account sending claim emails, via an App Password (Google Account
   * -> Security -> 2-Step Verification -> App passwords; requires 2FA on).
   * Switched to from Resend's test-mode sender, which turned out to only
   * allow sending to the Resend account's own email — a real respondent's
   * inbox would never receive anything without a verified domain.
   */
  gmailUser: requireEnv("GMAIL_USER"),
  gmailAppPassword: requireEnv("GMAIL_APP_PASSWORD"),
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
