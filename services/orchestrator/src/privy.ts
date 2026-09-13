import { NotFoundError, PrivyClient } from "@privy-io/node";
import type { LinkedAccount, User } from "@privy-io/node";
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

/**
 * Finds the embedded Ethereum wallet among a Privy User's linked accounts —
 * the shape returned by both users().create() and users().getByEmailAddress().
 */
function findEthereumWallet(user: User) {
  return user.linked_accounts.find(
    (
      account: LinkedAccount,
    ): account is Extract<LinkedAccount, { type: "wallet"; connector_type: "embedded"; chain_type: "ethereum" }> =>
      account.type === "wallet" &&
      "connector_type" in account &&
      account.connector_type === "embedded" &&
      "chain_type" in account &&
      account.chain_type === WALLET_CHAIN_TYPE,
  );
}

/**
 * Gets the respondent's payout wallet if one already exists (idempotent
 * across repeat claims/resubmissions for the same email), otherwise
 * provisions one — invisibly, no wallet UI ever shown to the respondent.
 *
 * Provisioned via Privy's real pre-generated-wallet mechanism —
 * `users().create()` with the respondent's email as a `linked_account` —
 * not the bare `wallets().create()` keyed by an opaque internal id this
 * used previously. That distinction matters: per Privy's own
 * pre-generated-wallets model, a wallet created this way is the one that
 * "automatically appears" the moment this respondent ever logs into a
 * Privy-powered client with this same email — the real, supported claim
 * path, confirmed against Privy's docs and the installed SDK's types
 * rather than assumed. No login/claim UI exists yet to use that path; this
 * only lays the groundwork so the wallet is actually claimable once one does.
 */
export async function getOrCreateRespondentWallet(email: string): Promise<{ id: string; address: string }> {
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await privy
    .users()
    .getByEmailAddress({ address: normalizedEmail })
    .catch((err) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });

  if (existingUser) {
    const wallet = findEthereumWallet(existingUser);
    if (wallet) return { id: wallet.id ?? "", address: wallet.address };
  }

  if (!config.privyRespondentPolicyId) {
    throw new Error(
      "PRIVY_RESPONDENT_POLICY_ID is not set — run `pnpm privy:setup-policy` once and put the printed policy id in .env",
    );
  }

  const user = await privy.users().create({
    linked_accounts: [{ type: "email", address: normalizedEmail }],
    wallets: [{ chain_type: WALLET_CHAIN_TYPE, policy_ids: [config.privyRespondentPolicyId] }],
  });

  const wallet = findEthereumWallet(user);
  if (!wallet) {
    throw new Error(`Privy user ${user.id} was created but has no ${WALLET_CHAIN_TYPE} wallet on it`);
  }
  return { id: wallet.id ?? "", address: wallet.address };
}
