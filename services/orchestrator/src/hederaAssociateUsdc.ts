/**
 * One-time setup: associates the treasury (operator) account with testnet
 * USDC. Hedera requires explicit token association before an account can
 * receive an HTS token — unlike HBAR, which every account accepts by
 * default.
 *
 * Run once: pnpm hedera:associate-usdc
 */
import { AccountId, Client, PrivateKey, TokenAssociateTransaction } from "@x402/hedera";
import { config } from "./config.js";
import { HEDERA_TESTNET_USDC_TOKEN_ID } from "./hederaMirror.js";

async function main() {
  const operatorId = AccountId.fromString(config.hederaAccountId);
  const operatorKey = PrivateKey.fromStringECDSA(config.hederaPrivateKey);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  try {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(operatorId)
      .setTokenIds([HEDERA_TESTNET_USDC_TOKEN_ID])
      .execute(client);
    const receipt = await tx.getReceipt(client);
    console.log(`Association status: ${receipt.status.toString()}`);
    console.log(`${config.hederaAccountId} can now receive testnet USDC (${HEDERA_TESTNET_USDC_TOKEN_ID}).`);
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("USDC association failed:", err);
  process.exit(1);
});
