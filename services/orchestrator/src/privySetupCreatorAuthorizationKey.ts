/**
 * One-time setup: generates a P-256 (secp256r1) "authorization key" and
 * registers it with Privy as a key quorum, so it can be set as the `owner`
 * of the creator pot-funding wallet (privyCreatorWallet.ts).
 *
 * The policy engine used for the respondent payout wallet
 * (privySetupPolicy.ts) can't gate this wallet the same way — its
 * `secp256k1_sign` RPC isn't a nameable `PolicyMethod` in the installed
 * SDK. A key-quorum owner is Privy's actual mechanism for this case: once
 * set, every mutating request against the wallet (including the raw-sign
 * RPC our funding bridge calls) must carry a
 * `privy-authorization-signature` computed with this key — not just our
 * app secret — confirmed from @privy-io/node/lib/authorization.d.ts and
 * resources/wallets/wallets.d.ts's WalletCreateParams.owner_id.
 *
 * Run once: pnpm privy:setup-creator-authorization-key
 * Then paste the two printed values into services/orchestrator/.env.
 */
import { generateKeyPairSync } from "node:crypto";
import { privy } from "./privy.js";

async function main() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateKeyBase64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  const keyQuorum = await privy.keyQuorums().create({
    display_name: "formdrop-creator-wallet-owner",
    authorization_threshold: 1,
    public_keys: [publicKeyBase64],
  });

  console.log("Created key quorum:", keyQuorum.id);
  console.log("\nAdd these to services/orchestrator/.env:");
  console.log(`PRIVY_CREATOR_KEY_QUORUM_ID=${keyQuorum.id}`);
  console.log(`PRIVY_CREATOR_AUTHORIZATION_PRIVATE_KEY=${privateKeyBase64}`);
  console.log(
    "\nThe private key above is the ONLY thing that can authorize this wallet's operations from now on — keep it as secret as any other credential in .env.",
  );
}

main().catch((err) => {
  console.error("Key quorum setup failed:", err);
  process.exit(1);
});
