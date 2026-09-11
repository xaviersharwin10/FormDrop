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

  /**
   * Which asset /verify's x402 price is denominated in. Defaults to USDC —
   * an HTS token, and @x402/hedera's own default settlement asset on both
   * Hedera networks (checked in the installed package: DEFAULT_ASSETS maps
   * testnet and mainnet to USDC, not HBAR) — rather than the HBAR price
   * this resource-server used at first. Kept switchable, not deleted: HBAR
   * settlement is still fully proven and still a legitimate mode.
   */
  settlementAsset: (process.env.X402_SETTLEMENT_ASSET ?? "USDC") as "HBAR" | "USDC",
  /** Testnet USDC HTS token id (6 decimals) — matches @x402/hedera's own HEDERA_TESTNET_USDC constant. */
  usdcAssetId: "0.0.429274",
  /** Price per verification call in USDC base units (6 decimals). 10000 = $0.01. */
  verificationPriceUsdcBaseUnits: process.env.VERIFICATION_PRICE_USDC_BASE_UNITS ?? "10000",

  /** Free-tier key from aistudio.google.com/apikey. */
  geminiApiKey: requireEnv("GEMINI_API_KEY"),
};
