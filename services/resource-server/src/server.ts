import Fastify from "fastify";
import { paymentMiddleware } from "@x402/fastify";
import type { FormSubmissionPayload } from "@paid-forms/shared";
import { config } from "./config.js";
import { HBAR_ASSET_ID, resourceServer } from "./x402.js";
import { runVerification } from "./verify.js";

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
          price: { amount: config.verificationPriceTinybar, asset: HBAR_ASSET_ID },
        },
        description: "AI judgment of one Google Form response for quality and fraud signals",
        mimeType: "application/json",
      },
    },
    resourceServer,
  );

  app.post<{ Body: FormSubmissionPayload }>("/verify", async (request, reply) => {
    const verdict = await runVerification(request.body);
    return reply.send(verdict);
  });

  return app;
}
