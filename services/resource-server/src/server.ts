import Fastify from "fastify";
import { paymentMiddleware } from "@x402/fastify";
import type { VerifyRequestBody } from "@formdrop/shared";
import { config } from "./config.js";
import { HBAR_ASSET_ID, resourceServer } from "./x402.js";
import { runVerification } from "./verify.js";

const price =
  config.settlementAsset === "USDC"
    ? { amount: config.verificationPriceUsdcBaseUnits, asset: config.usdcAssetId }
    : { amount: config.verificationPriceTinybar, asset: HBAR_ASSET_ID };

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  paymentMiddleware(
    app,
    {
      "POST /verify": {
        accepts: {
          scheme: "exact",
          network: config.hederaNetwork,
          payTo: config.hederaPayToAccountId,
          price,
        },
        description: "AI judgment of one Google Form response for quality and fraud signals",
        mimeType: "application/json",
      },
    },
    resourceServer,
  );

  app.post<{ Body: VerifyRequestBody }>("/verify", async (request, reply) => {
    const { payload, priorAnswerTexts } = request.body;
    const verdict = await runVerification(payload, priorAnswerTexts ?? []);
    return reply.send(verdict);
  });

  return app;
}
