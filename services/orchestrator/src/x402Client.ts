import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { config } from "./config.js";
import { HEDERA_TESTNET_USDC_TOKEN_ID } from "./hederaMirror.js";

const hederaSigner = createClientHederaSigner(
  config.hederaAccountId,
  PrivateKey.fromStringECDSA(config.hederaPrivateKey),
  { network: config.hederaNetwork },
);

const coreClient = new x402Client()
  .register("hedera:*", new ExactHederaScheme(hederaSigner))
  .setSpendControls({
    // Neither asset is one of the core client's recognized "default assets"
    // once this list is provided explicitly, so both are opted in by hand
    // rather than disabling spend controls outright. Caps are sanity
    // ceilings well above the per-call verification price, not real
    // budgets: 0.1 HBAR, or $1.00 of testnet USDC (6 decimals).
    allowedAssets: [
      { network: config.hederaNetwork, asset: "0.0.0", maxAmountPerPayment: "10000000" },
      { network: config.hederaNetwork, asset: HEDERA_TESTNET_USDC_TOKEN_ID, maxAmountPerPayment: "1000000" },
    ],
  });

/** Wrapped fetch: on a 402 it signs and retries automatically with the X-PAYMENT header. */
export const fetchWithPayment = wrapFetchWithPayment(fetch, coreClient);

/** Used after a paid call to decode the X-PAYMENT-RESPONSE settlement header. */
export const httpClient = new x402HTTPClient(coreClient);
