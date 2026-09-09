import { createHash } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import { config } from "./config.js";

export const privy = new PrivyClient({
  appId: config.privyAppId,
  appSecret: config.privyAppSecret,
});

/**
 * Privy has no native Hedera chain type, but Hedera accounts use the same
 * secp256k1 curve as Ethereum and supports "auto account creation" from an
 * EVM address alias (HIP-583): sending HBAR to an address that's never
 * touched Hedera creates a hollow account for it automatically. So a Privy
 * `ethereum`-type embedded wallet's address doubles as a valid Hedera
 * payout destination — no bridging, no extra key material, and (a genuine
 * property, not just a fact) that hollow account can only *receive* until
 * it signs an outbound transaction itself, which fits a respondent wallet
 * that's meant to be receive-only for this product.
 */
const WALLET_CHAIN_TYPE = "ethereum" as const;

/** Deterministic, URL-safe external_id for a respondent — Privy's external_id only allows [a-zA-Z0-9_-]. */
function respondentExternalId(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/**
 * Gets the respondent's payout wallet if one already exists (idempotent
 * across repeat claims/resubmissions for the same email), otherwise
 * provisions one — invisibly, no wallet UI ever shown to the respondent.
 */
export async function getOrCreateRespondentWallet(email: string): Promise<{ id: string; address: string }> {
  const externalId = respondentExternalId(email);

  const existing = await privy.wallets().list({ external_id: externalId, chain_type: WALLET_CHAIN_TYPE });
  for await (const wallet of existing) {
    return { id: wallet.id, address: wallet.address };
  }

  if (!config.privyRespondentPolicyId) {
    throw new Error(
      "PRIVY_RESPONDENT_POLICY_ID is not set — run `pnpm privy:setup-policy` once and put the printed policy id in .env",
    );
  }

  const wallet = await privy.wallets().create({
    chain_type: WALLET_CHAIN_TYPE,
    external_id: externalId,
    policy_ids: [config.privyRespondentPolicyId],
  });

  return { id: wallet.id, address: wallet.address };
}
