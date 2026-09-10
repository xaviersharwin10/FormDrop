const MIRROR_NODE_BASE = "https://testnet.mirrornode.hedera.com";

export const HEDERA_TESTNET_USDC_TOKEN_ID = "0.0.429274";
/** Testnet USDC has 6 decimals; 1 USD cent = 10,000 base units. */
export const USDC_BASE_UNITS_PER_USD_CENT = 10_000n;

/** Mirror Node path form: 0.0.x-seconds-nanos (SDK gives 0.0.x@seconds.nanos). */
function toMirrorTransactionId(transactionId: string): string {
  return transactionId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
}

/**
 * Confirms — independently, on the public ledger, not just trusting the
 * creator's word — that a real transfer of at least `minAmountTinybar`
 * landed in `expectedToAccountId`. This is what makes "this form is funded
 * and locked" a credible guarantee instead of a promise.
 */
export async function verifyIncomingHbarTransfer(
  transactionId: string,
  expectedToAccountId: string,
  minAmountTinybar: bigint,
): Promise<boolean> {
  const res = await fetch(
    `${MIRROR_NODE_BASE}/api/v1/transactions/${encodeURIComponent(toMirrorTransactionId(transactionId))}`,
  );
  if (!res.ok) return false;

  const data = (await res.json()) as {
    transactions?: Array<{
      result: string;
      name: string;
      transfers: Array<{ account: string; amount: number }>;
    }>;
  };

  // A single transaction id can resolve to multiple records (e.g. the real
  // CRYPTOTRANSFER at nonce 0, plus a synthesized CRYPTOCREATEACCOUNT fee
  // record at nonce 1 when the recipient is a fresh hollow account) —
  // check every record's transfers, not just the first one.
  for (const tx of data.transactions ?? []) {
    if (tx.result !== "SUCCESS") continue;
    const credited = tx.transfers.find((t) => t.account === expectedToAccountId);
    if (credited !== undefined && BigInt(credited.amount) >= minAmountTinybar) {
      return true;
    }
  }
  return false;
}

/**
 * Same independent-verification approach as verifyIncomingHbarTransfer,
 * for HTS token transfers (e.g. testnet USDC) — the "or crypto in" funding
 * path isn't limited to native HBAR.
 */
export async function verifyIncomingTokenTransfer(
  transactionId: string,
  expectedToAccountId: string,
  tokenId: string,
  minAmount: bigint,
): Promise<boolean> {
  const res = await fetch(
    `${MIRROR_NODE_BASE}/api/v1/transactions/${encodeURIComponent(toMirrorTransactionId(transactionId))}`,
  );
  if (!res.ok) return false;

  const data = (await res.json()) as {
    transactions?: Array<{
      result: string;
      token_transfers: Array<{ token_id: string; account: string; amount: number }>;
    }>;
  };

  for (const tx of data.transactions ?? []) {
    if (tx.result !== "SUCCESS") continue;
    const credited = tx.token_transfers.find((t) => t.token_id === tokenId && t.account === expectedToAccountId);
    if (credited !== undefined && BigInt(credited.amount) >= minAmount) {
      return true;
    }
  }
  return false;
}
