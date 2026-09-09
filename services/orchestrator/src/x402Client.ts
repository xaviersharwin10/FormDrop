import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { config } from "./config.js";

const hederaSigner = createClientHederaSigner(
  config.hederaAccountId,
  PrivateKey.fromStringECDSA(config.hederaPrivateKey),
  { network: config.hederaNetwork },
);

const coreClient = new x402Client()
  .register("hedera:*", new ExactHederaScheme(hederaSigner))
  .setSpendControls({
    // HBAR isn't one of the core client's recognized "default assets" (those
    // are well-known stablecoins), so it's opted in explicitly here rather
    // than disabling spend controls outright. Capped well above our per-call
    // verification price as a sanity ceiling, not a real budget limit.
    allowedAssets: [
      { network: config.hederaNetwork, asset: "0.0.0", maxAmountPerPayment: "10000000" },
    ],
  });

/** Wrapped fetch: on a 402 it signs and retries automatically with the X-PAYMENT header. */
export const fetchWithPayment = wrapFetchWithPayment(fetch, coreClient);

/** Used after a paid call to decode the X-PAYMENT-RESPONSE settlement header. */
export const httpClient = new x402HTTPClient(coreClient);
