import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@x402/hedera";
import { config } from "./config.js";

/**
 * Pays HBAR from our operating account to a Privy embedded wallet's EVM
 * address. Hedera auto-creates a "hollow" account for that address on
 * first receipt (HIP-583) — the respondent never needs an existing Hedera
 * account, and the resulting account can only receive until it signs an
 * outbound transaction itself, which we never ask it to do.
 */
export async function payHbarToEvmAddress(evmAddress: string, amountTinybar: string): Promise<string> {
  const operatorId = AccountId.fromString(config.hederaAccountId);
  const operatorKey = PrivateKey.fromStringECDSA(config.hederaPrivateKey);
  const recipient = AccountId.fromEvmAddress(0, 0, evmAddress);
  const amount = Hbar.fromTinybars(amountTinybar);

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  try {
    const tx = await new TransferTransaction()
      .addHbarTransfer(operatorId, amount.negated())
      .addHbarTransfer(recipient, amount)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    if (receipt.status.toString() !== "SUCCESS") {
      throw new Error(`Payout transaction status: ${receipt.status.toString()}`);
    }
    return tx.transactionId.toString();
  } finally {
    client.close();
  }
}
