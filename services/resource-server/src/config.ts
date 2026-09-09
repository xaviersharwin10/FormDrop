import "dotenv/config";
import type { Network } from "@x402/core/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  /** Hedera account that RECEIVES x402 payments. Public info — no private key needed here; only the paying client signs. */
  hederaPayToAccountId: requireEnv("HEDERA_PAY_TO_ACCOUNT_ID"),
  hederaNetwork: (process.env.HEDERA_NETWORK ?? "hedera:testnet") as Network,
  facilitatorUrl:
    process.env.BLOCKY402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com",
  verificationPriceTinybar: process.env.VERIFICATION_PRICE_TINYBAR ?? "100000",
  port: Number(process.env.PORT ?? 4001),
};
