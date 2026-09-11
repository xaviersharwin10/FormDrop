import { AccountId, Client, Hbar, PrivateKey, TransferTransaction } from "@x402/hedera";
import { config } from "./config.js";
import { getOrCreateCreatorWallet } from "./privyCreatorWallet.js";
import { recoverPrivyWalletPublicKey, signHederaTransactionWithPrivy } from "./hederaPrivySigner.js";

/**
 * Funds a form's payout pot by moving HBAR out of the creator's own
 * Privy-custodied wallet into our treasury — the transfer is authorized by
 * a live Privy signature (via hederaPrivySigner.ts), not by us holding the
 * creator's key material. Hedera auto-creates a "hollow" account for the
 * wallet's EVM address on first receipt (HIP-583), same mechanism already
 * used for respondent payouts, so the creator only ever needs to send
 * testnet HBAR to a plain address — no separate Hedera account setup.
 *
 * We stay the fee payer (our own operator account) so the creator's wallet
 * only needs exactly the pot amount, not extra for network fees.
 */
export async function fundPotFromCreatorWallet(
  formId: string,
  potTinybar: string,
): Promise<{ transactionId: string; creatorAddress: string }> {
  const wallet = await getOrCreateCreatorWallet(formId);
  const publicKey = await recoverPrivyWalletPublicKey(wallet.id, wallet.address);

  const operatorId = AccountId.fromString(config.hederaAccountId);
  const operatorKey = PrivateKey.fromStringECDSA(config.hederaPrivateKey);
  const creatorAccountId = AccountId.fromEvmAddress(0, 0, wallet.address);
  const amount = Hbar.fromTinybars(potTinybar);

  const client = Client.forTestnet().setOperator(operatorId, operatorKey);
  try {
    const transaction = new TransferTransaction()
      .addHbarTransfer(creatorAccountId, amount.negated())
      .addHbarTransfer(operatorId, amount)
      .freezeWith(client);

    await signHederaTransactionWithPrivy(transaction, wallet.id, publicKey);

    const submitted = await transaction.execute(client);
    const receipt = await submitted.getReceipt(client);
    if (receipt.status.toString() !== "SUCCESS") {
      throw new Error(`Funding transfer status: ${receipt.status.toString()}`);
    }

    return { transactionId: submitted.transactionId.toString(), creatorAddress: wallet.address };
  } finally {
    client.close();
  }
}
