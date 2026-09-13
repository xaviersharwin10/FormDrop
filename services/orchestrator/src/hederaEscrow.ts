import {
  AccountId,
  Client,
  ContractCallQuery,
  ContractCreateFlow,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  Hbar,
  PrivateKey,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { config, requireEscrowContractId } from "./config.js";

/**
 * A `ContractExecuteTransaction`'s payable amount is funded entirely by
 * whichever account is the transaction's designated payer — unlike
 * `TransferTransaction`, there's no separate "named debit account" concept.
 * So a creator's wallet, funding the pot, ends up paying the network fee
 * itself too (confirmed empirically: a 5,000,000-tinybar fundPot call cost
 * the creator wallet ~10,397,332 tinybars total). This buffer is required
 * on top of the exact pot amount so the transaction doesn't fail on an
 * under-funded wallet.
 */
export const FUND_FEE_BUFFER_TINYBAR = 20_000_000n; // 0.2 HBAR — comfortably covers the observed ~0.1 HBAR fee

function operatorClient(): Client {
  const operatorId = AccountId.fromString(config.hederaAccountId);
  const operatorKey = PrivateKey.fromStringECDSA(config.hederaPrivateKey);
  return Client.forTestnet().setOperator(operatorId, operatorKey);
}

/**
 * For an ECDSA-keyed Hedera account, `msg.sender` inside the EVM is the
 * account's real alias EVM address (derived from its public key) — NOT
 * `AccountId.toSolidityAddress()`'s long-zero form (0x00...<accountNum>).
 * Confirmed empirically: deploying the escrow with the long-zero form as
 * `operator` made every payout() call revert with "not operator" despite
 * the stored value matching that form exactly — the actual runtime
 * msg.sender was this alias address instead. Cached since it never changes
 * for a fixed operator account.
 */
let cachedOperatorEvmAddress: string | null = null;
async function getOperatorEvmAddress(): Promise<string> {
  if (cachedOperatorEvmAddress) return cachedOperatorEvmAddress;
  const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${config.hederaAccountId}`);
  const data = (await res.json()) as { evm_address?: string };
  if (!data.evm_address) throw new Error(`Mirror Node returned no evm_address for ${config.hederaAccountId}`);
  cachedOperatorEvmAddress = data.evm_address;
  return data.evm_address;
}

/**
 * Deploys a fresh FormDropEscrow contract with the operator account as its
 * authorized signer. One-time setup — see `hederaEscrowDeploy.ts`.
 */
export async function deployEscrowContract(bytecode: string): Promise<string> {
  const client = operatorClient();
  try {
    const operatorEvmAddress = await getOperatorEvmAddress();
    const flow = new ContractCreateFlow()
      .setBytecode(bytecode)
      .setGas(1_500_000)
      .setConstructorParameters(new ContractFunctionParameters().addAddress(operatorEvmAddress));
    const submitted = await flow.execute(client);
    const receipt = await submitted.getReceipt(client);
    if (!receipt.contractId) {
      throw new Error(`Escrow deployment status: ${receipt.status.toString()}, no contractId returned`);
    }
    return receipt.contractId.toString();
  } finally {
    client.close();
  }
}

/**
 * `TransactionId.generate()` needs a real numbered AccountId (shard.realm.num)
 * — an EVM-alias-only AccountId (`AccountId.fromEvmAddress`) isn't enough
 * (confirmed empirically: it produced `PAYER_ACCOUNT_NOT_FOUND` with an
 * all-zero account id). The account must already exist (have received
 * something) for the Mirror Node to have a numbered id to resolve.
 */
export async function resolveNumberedAccountId(evmAddress: string): Promise<AccountId> {
  const res = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${evmAddress}`);
  if (!res.ok) throw new Error(`Mirror Node lookup for ${evmAddress} failed: HTTP ${res.status}`);
  const data = (await res.json()) as { account?: string };
  if (!data.account) throw new Error(`Mirror Node returned no numbered account for ${evmAddress}`);
  return AccountId.fromString(data.account);
}

/**
 * Builds (unfrozen) the ContractExecuteTransaction that funds a form's pot,
 * paid entirely by `payerAccountId` — a caller freezes it against their own
 * client and signs it (the Privy bridge needs the unfrozen transaction to
 * attach its own signer).
 */
export function buildFundPotTransaction(
  formId: string,
  amountTinybar: string,
  payerAccountId: AccountId,
): ContractExecuteTransaction {
  return new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(requireEscrowContractId()))
    .setGas(200_000)
    .setPayableAmount(Hbar.fromTinybars(amountTinybar))
    .setFunction("fundPot", new ContractFunctionParameters().addString(formId))
    .setTransactionId(TransactionId.generate(payerAccountId));
}

/** Reads a form's remaining on-chain pot balance, in tinybars. */
export async function getEscrowPotBalanceTinybar(formId: string): Promise<string> {
  const client = operatorClient();
  try {
    const result = await new ContractCallQuery()
      .setContractId(ContractId.fromString(requireEscrowContractId()))
      .setGas(50_000)
      .setFunction("getPotBalance", new ContractFunctionParameters().addString(formId))
      .execute(client);
    return result.getUint256(0).toString();
  } finally {
    client.close();
  }
}

/**
 * Pays a respondent out of a form's on-chain escrow pot. Only the operator
 * account may call this (enforced by the contract itself), and the
 * contract independently enforces "never pay the same (formId, responseId)
 * twice" and "never pay out more than was actually funded" — real
 * on-chain invariants, not just application-level checks.
 *
 * A brand-new recipient EVM address must be "pre-warmed" with a plain
 * top-level transfer first: confirmed empirically that Hedera's
 * hollow-account auto-creation (HIP-583) fires for a top-level
 * CryptoTransfer but NOT for a contract's internal `.call{value}` — the
 * latter just fails with "transfer failed" against an address that has
 * never received anything. Harmless/idempotent to repeat for an address
 * that already exists (a single extra 1-tinybar transfer), so it's always
 * done rather than tracked per-address.
 */
export async function payoutFromEscrow(
  formId: string,
  responseId: string,
  recipientEvmAddress: string,
  amountTinybar: string,
): Promise<string> {
  const operatorId = AccountId.fromString(config.hederaAccountId);
  const client = operatorClient();
  try {
    const warmUp = await new TransferTransaction()
      .addHbarTransfer(operatorId, Hbar.fromTinybars("-1"))
      .addHbarTransfer(AccountId.fromEvmAddress(0, 0, recipientEvmAddress), Hbar.fromTinybars("1"))
      .execute(client);
    const warmReceipt = await warmUp.getReceipt(client);
    if (warmReceipt.status.toString() !== "SUCCESS") {
      throw new Error(`Pre-warm transfer status: ${warmReceipt.status.toString()}`);
    }

    const tx = await new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(requireEscrowContractId()))
      .setGas(300_000)
      .setFunction(
        "payout",
        new ContractFunctionParameters()
          .addString(formId)
          .addString(responseId)
          .addAddress(recipientEvmAddress)
          .addUint256(Number(amountTinybar)),
      )
      .execute(client);
    const receipt = await tx.getReceipt(client);
    if (receipt.status.toString() !== "SUCCESS") {
      throw new Error(`Escrow payout status: ${receipt.status.toString()}`);
    }
    return tx.transactionId.toString();
  } finally {
    client.close();
  }
}
