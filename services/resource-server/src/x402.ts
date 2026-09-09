import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { config } from "./config.js";

const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

export const resourceServer = new x402ResourceServer(facilitatorClient).register(
  "hedera:*",
  new ExactHederaScheme(),
);

/** HBAR asset id per the x402 Hedera scheme (`asset: "0.0.0"` means native HBAR). */
export const HBAR_ASSET_ID = "0.0.0";
