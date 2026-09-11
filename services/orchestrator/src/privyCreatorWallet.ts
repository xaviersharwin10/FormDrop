import { createHash } from "node:crypto";
import { privy } from "./privy.js";
import { config } from "./config.js";

const WALLET_CHAIN_TYPE = "ethereum" as const;

/** Deterministic, URL-safe external_id per form — Privy's external_id only allows [a-zA-Z0-9_-]. */
function creatorExternalId(formId: string): string {
  return `creator-${createHash("sha256").update(formId).digest("hex").slice(0, 55)}`;
}

/**
 * Gets the wallet a form's creator uses to fund its payout pot, or
 * provisions one — idempotent per formId, invisible to the creator until
 * they're asked to send it testnet HBAR/USDC.
 *
 * Unlike the respondent wallet (services/orchestrator/src/privy.ts), this
 * one can't use a Privy *policy*: `secp256k1_sign` — the only RPC method
 * this wallet is ever asked to perform, via hederaPrivySigner.ts — isn't in
 * the installed SDK's `PolicyMethod` enum (checked in
 * @privy-io/node/resources/policies.d.ts), so there's no rule that can name
 * it specifically the way privySetupPolicy.ts's "deny everything" rule
 * names `"*"`.
 *
 * Instead this wallet's `owner_id` is set to a key quorum — one P-256
 * authorization key we generate and hold ourselves, via
 * `pnpm privy:setup-creator-authorization-key`
 * (privySetupCreatorAuthorizationKey.ts). Once set, Privy requires every
 * mutating request against this wallet (including the raw-sign RPC that
 * moves its funds) to carry a `privy-authorization-signature` computed
 * with that key — confirmed in @privy-io/node/lib/authorization.d.ts and
 * WalletCreateParams.owner_id. hederaPrivySigner.ts supplies that
 * signature on every call. This is a real, separate control — holding
 * PRIVY_APP_SECRET alone is no longer enough to make this wallet sign
 * anything.
 */
export async function getOrCreateCreatorWallet(formId: string): Promise<{ id: string; address: string }> {
  const externalId = creatorExternalId(formId);

  const existing = await privy.wallets().list({ external_id: externalId, chain_type: WALLET_CHAIN_TYPE });
  for await (const wallet of existing) {
    return { id: wallet.id, address: wallet.address };
  }

  if (!config.privyCreatorKeyQuorumId) {
    throw new Error(
      "PRIVY_CREATOR_KEY_QUORUM_ID is not set — run `pnpm privy:setup-creator-authorization-key` once and put the printed values in .env",
    );
  }

  const wallet = await privy.wallets().create({
    chain_type: WALLET_CHAIN_TYPE,
    external_id: externalId,
    owner_id: config.privyCreatorKeyQuorumId,
  });

  return { id: wallet.id, address: wallet.address };
}
