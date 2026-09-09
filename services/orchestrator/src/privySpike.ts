/**
 * Proves the respondent payout path end to end: provision a Privy embedded
 * wallet by email (no wallet UI, no seed phrase), then pay it real testnet
 * HBAR via Hedera's EVM-address auto-account-creation.
 *
 * Run: pnpm privy:spike
 * (requires PRIVY_RESPONDENT_POLICY_ID set — run `pnpm privy:setup-policy` first)
 */
import { getOrCreateRespondentWallet } from "./privy.js";
import { payHbarToEvmAddress } from "./hederaPayout.js";

async function main() {
  const testEmail = `grace+${Date.now()}@example.com`;

  console.log(`Provisioning payout wallet for ${testEmail}...`);
  const wallet = await getOrCreateRespondentWallet(testEmail);
  console.log("Wallet:", wallet);

  console.log(`\nPaying 0.001 HBAR to ${wallet.address}...`);
  const txId = await payHbarToEvmAddress(wallet.address, "100000");
  console.log("Payout transaction:", txId);

  console.log(
    `\nSpike succeeded — Privy wallet provisioned by email, paid on Hedera testnet, no wallet UI shown.`,
  );
}

main().catch((err) => {
  console.error("Privy spike failed:", err);
  process.exit(1);
});
