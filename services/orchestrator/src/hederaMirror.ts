const MIRROR_NODE_BASE = "https://testnet.mirrornode.hedera.com";

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
