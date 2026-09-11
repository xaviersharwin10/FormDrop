/**
 * One-time setup: creates a fresh Hedera account for resource-server to
 * receive x402 settlement in, and associates it with testnet USDC.
 *
 * Why a new account instead of associating the existing
 * HEDERA_PAY_TO_ACCOUNT_ID: token association requires a signature from
 * the account being associated (Hedera's anti-spam rule — an account must
 * consent to holding a token), and we don't hold a private key for the
 * existing pay-to account here — by design, resource-server's config
 * comment says "no private key needed here; only the paying client
 * signs." Rather than ask for a key that might not be recoverable, this
 * generates a brand new keypair, uses it once to fund a hollow account
 * (same HIP-583 pattern used everywhere else in this codebase) and sign
 * its own association, then deliberately discards the private key —
 * resource-server never needs to sign anything again after this.
 *
 * Run once: pnpm hedera:setup-usdc-pay-to-account
 * Then paste the printed account id into services/resource-server/.env as
 * HEDERA_PAY_TO_ACCOUNT_ID.
 */
import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TransferTransaction,
} from "@x402/hedera";
import { config } from "./config.js";
import { HEDERA_TESTNET_USDC_TOKEN_ID } from "./hederaMirror.js";

async function findAccountIdByEvmAddress(evmAddress: string): Promise<string> {
  const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`);
  if (!res.ok) throw new Error(`Mirror Node lookup failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account: string };
  return body.account;
}

async function main() {
  const operatorId = AccountId.fromString(config.hederaAccountId);
  const operatorKey = PrivateKey.fromStringECDSA(config.hederaPrivateKey);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  try {
    const newKey = PrivateKey.generateECDSA();
    const evmAddress = newKey.publicKey.toEvmAddress();
    const newAccountAlias = AccountId.fromEvmAddress(0, 0, evmAddress);

    console.log("Funding a hollow account for the new pay-to account...");
    const fundTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, Hbar.fromTinybars("100000000").negated())
      .addHbarTransfer(newAccountAlias, Hbar.fromTinybars("100000000"))
      .execute(client);
    const fundReceipt = await fundTx.getReceipt(client);
    if (fundReceipt.status.toString() !== "SUCCESS") {
      throw new Error(`Funding transfer status: ${fundReceipt.status.toString()}`);
    }

    const accountId = await findAccountIdByEvmAddress(evmAddress);
    console.log("New pay-to account created:", accountId);

    console.log("Associating it with testnet USDC...");
    const associateTx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(accountId))
      .setTokenIds([HEDERA_TESTNET_USDC_TOKEN_ID])
      .freezeWith(client)
      .sign(newKey);
    const associateResult = await associateTx.execute(client);
    const associateReceipt = await associateResult.getReceipt(client);
    if (associateReceipt.status.toString() !== "SUCCESS") {
      throw new Error(`Association status: ${associateReceipt.status.toString()}`);
    }

    console.log("\nAdd this to services/resource-server/.env:");
    console.log(`HEDERA_PAY_TO_ACCOUNT_ID=${accountId}`);
    console.log(
      "\nThe private key for this account was generated, used once, and discarded — resource-server never needs to sign anything to receive payments.",
    );
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("Pay-to account setup failed:", err);
  process.exit(1);
});
