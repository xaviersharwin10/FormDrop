import { keccak_256 } from "@noble/hashes/sha3";
import { secp256k1 } from "@noble/curves/secp256k1";
import { PublicKey, Transaction } from "@hiero-ledger/sdk";
import { privy } from "./privy.js";
import { config } from "./config.js";

/**
 * Bridges a Privy-custodied wallet into Hedera's transaction signing.
 *
 * Confirmed from the installed SDKs (not assumed):
 *  - Privy's `wallets().rpc(walletId, { method: "secp256k1_sign", params:
 *    { hash } })` signs an arbitrary pre-computed 32-byte hash and returns a
 *    raw signature (@privy-io/node/resources/wallets/wallets.d.ts). The
 *    higher-level `.rpc()` wrapper (vs. the raw `._rpc()`) additionally
 *    accepts `authorization_context` and computes the
 *    `privy-authorization-signature` header itself
 *    (@privy-io/node/lib/authorization.d.ts) — needed here because the
 *    creator wallet's `owner_id` is a key quorum (see
 *    privyCreatorWallet.ts), so every call like this one must be
 *    authorized with that key, not just our app secret.
 *  - Hedera's `Transaction.signWith(publicKey, transactionSigner)` calls
 *    `transactionSigner(bodyBytes)` once per node with the RAW, UNHASHED
 *    transaction body, and expects back a 64-byte compact (r||s) ECDSA
 *    signature — no recovery byte — which it drops straight into the
 *    protobuf sigPair (@hiero-ledger/sdk/src/transaction/Transaction.js,
 *    src/PublicKey.js `_toProtobufSignature`).
 *  - Hedera's own ECDSA `PrivateKey.sign()` hashes that same message with
 *    Keccak-256 before signing (@hiero-ledger/cryptography/src/primitive/
 *    ecdsa.js) — so replicating that hash ourselves before calling Privy is
 *    what makes a Privy signature verify as a valid Hedera transaction
 *    signature.
 */

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function requireCreatorAuthorizationKey(): string {
  if (!config.privyCreatorAuthorizationPrivateKey) {
    throw new Error(
      "PRIVY_CREATOR_AUTHORIZATION_PRIVATE_KEY is not set — run `pnpm privy:setup-creator-authorization-key` once and put the printed values in .env",
    );
  }
  return config.privyCreatorAuthorizationPrivateKey;
}

async function privySignHash(walletId: string, hash: Uint8Array): Promise<Uint8Array> {
  const response = await privy.wallets().rpc(walletId, {
    method: "secp256k1_sign",
    params: { hash: `0x${toHex(hash)}` },
    authorization_context: { authorization_private_keys: [requireCreatorAuthorizationKey()] },
  });
  // The return type is narrowed by `method`, but that narrowing is lost
  // through this module's generic wrapper — assert the one shape
  // `secp256k1_sign` actually returns (confirmed in
  // @privy-io/node/resources/wallets/wallets.d.ts:
  // EthereumSecp256k1SignRpcResponseData).
  const data = response.data as { signature: string } | undefined;
  if (!data?.signature) {
    throw new Error("Privy secp256k1_sign RPC returned no signature");
  }
  const sigBytes = Buffer.from(data.signature.replace(/^0x/, ""), "hex");
  // Ethereum-style signers may return 65 bytes (r || s || v); Hedera wants
  // only the 64-byte compact (r || s) portion.
  return sigBytes.subarray(0, 64);
}

/**
 * Privy never exposes a wallet's raw public key — only its address, a
 * one-way hash of the key. We recover the actual secp256k1 public key from
 * one throwaway signature via ECDSA public-key recovery, the same math
 * Ethereum uses to recover `msg.sender` from `(v, r, s)`. This only needs
 * to run once per wallet; callers should cache the result.
 */
export async function recoverPrivyWalletPublicKey(walletId: string, expectedAddress: string): Promise<PublicKey> {
  const probe = keccak_256(new TextEncoder().encode(`formdrop-pubkey-probe:${walletId}`));
  const signature = await privySignHash(walletId, probe);
  const compactSig = secp256k1.Signature.fromCompact(signature);
  const wantAddress = expectedAddress.toLowerCase().replace(/^0x/, "");

  for (const recovery of [0, 1] as const) {
    const recovered = compactSig.addRecoveryBit(recovery).recoverPublicKey(probe);
    const uncompressed = recovered.toRawBytes(false);
    const derivedAddress = toHex(keccak_256(uncompressed.subarray(1)).slice(-20));
    if (derivedAddress === wantAddress) {
      return PublicKey.fromBytesECDSA(Buffer.from(recovered.toRawBytes(true)));
    }
  }

  throw new Error(`Could not recover a public key for Privy wallet ${walletId} matching address ${expectedAddress}`);
}

/** Signs a frozen Hedera transaction with a Privy-custodied wallet. */
export async function signHederaTransactionWithPrivy(
  transaction: Transaction,
  walletId: string,
  publicKey: PublicKey,
): Promise<void> {
  await transaction.signWith(publicKey, async (message) => privySignHash(walletId, keccak_256(message)));
}
