/** Hedera SDK gives "0.0.x@seconds.nanos"; HashScan's URL form is "0.0.x-seconds-nanos". */
export function hashscanTransactionUrl(transactionId: string): string {
  const hashscanId = transactionId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  return `https://hashscan.io/testnet/transaction/${hashscanId}`;
}

export function hashscanAccountUrl(accountIdOrEvmAddress: string): string {
  return `https://hashscan.io/testnet/account/${accountIdOrEvmAddress}`;
}

export function hashscanTopicUrl(topicId: string): string {
  return `https://hashscan.io/testnet/topic/${topicId}`;
}
