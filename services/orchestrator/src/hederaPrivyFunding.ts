import { AccountId, Client, PrivateKey } from "@x402/hedera";
import { config } from "./config.js";
import { getOrCreateCreatorWallet } from "./privyCreatorWallet.js";
import { recoverPrivyWalletPublicKey, signHederaTransactionWithPrivy } from "./hederaPrivySigner.js";
import { buildFundPotTransaction, resolveNumberedAccountId } from "./hederaEscrow.js";

/**
 * Funds a form's payout pot by calling the escrow contract's `fundPot`
 * directly from the creator's own Privy-custodied wallet — authorized by a
 * live Privy signature (via hederaPrivySigner.ts), not by us holding the
 * creator's key material. Hedera auto-creates a "hollow" account for the
 * wallet's EVM address on first receipt (HIP-583), so the creator only
 * ever needs to send testnet HBAR to a plain address — no separate Hedera
 * account setup.
 *
 * Unlike the pre-contract version of this function, the creator's wallet
 * itself pays the network fee for this call too — a ContractExecuteTransaction's
 * payable amount and its fee both come from the same designated payer
 * account, unlike a plain TransferTransaction's flexible multi-account
 * list. See FUND_FEE_BUFFER_TINYBAR in hederaEscrow.ts.
 */
export async function fundPotFromCreatorWallet(
  formId: string,
  potTinybar: string,
): Promise<{ transactionId: string; creatorAddress: string }> {
  const wallet = await getOrCreateCreatorWallet(formId);
  const publicKey = await recoverPrivyWalletPublicKey(wallet.id, wallet.address);
  const creatorAccountId = await resolveNumberedAccountId(wallet.address);

  const operatorId = AccountId.fromString(config.hederaAccountId);
  const operatorKey = PrivateKey.fromStringECDSA(config.hederaPrivateKey);
  const client = Client.forTestnet().setOperator(operatorId, operatorKey);

  try {
    const transaction = buildFundPotTransaction(formId, potTinybar, creatorAccountId).freezeWith(client);

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
