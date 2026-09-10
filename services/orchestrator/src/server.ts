import Fastify from "fastify";
import cors from "@fastify/cors";
import { parseFormSubmissionPayload } from "./validate.js";
import { handleFormSubmit } from "./webhook.js";
import { getFormConfig, markFunded, setFormConfig } from "./formConfigStore.js";
import { getResponse, getResponsesForForm } from "./responseStore.js";
import { verifyIncomingHbarTransfer } from "./hederaMirror.js";
import { config } from "./config.js";
import { claimAction, ClaimError, processClaim } from "./claim.js";
import { getRpSignature } from "./world.js";
import type { IdKitVerifyPayload } from "./world.js";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));

  app.post("/webhook/form-submit", async (request, reply) => {
    let payload;
    try {
      payload = parseFormSubmissionPayload(request.body);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }

    try {
      const result = await handleFormSubmit(payload);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, "handleFormSubmit failed");
      return reply.status(502).send({ error: "verification call failed" });
    }
  });

  app.post("/forms", async (request, reply) => {
    const body = request.body as Partial<{
      formId: string;
      pricePerResponseTinybar: string;
      maxResponses: number;
    }>;

    if (
      typeof body.formId !== "string" ||
      body.formId === "" ||
      typeof body.pricePerResponseTinybar !== "string" ||
      typeof body.maxResponses !== "number" ||
      body.maxResponses <= 0
    ) {
      return reply.status(400).send({ error: "formId, pricePerResponseTinybar, maxResponses are required" });
    }

    const config = {
      formId: body.formId,
      pricePerResponseTinybar: body.pricePerResponseTinybar,
      maxResponses: body.maxResponses,
      createdAtIso: new Date().toISOString(),
    };
    setFormConfig(config);
    return reply.send(config);
  });

  app.get("/forms/:formId/treasury", async () => ({ treasuryAccountId: config.hederaAccountId }));

  app.post("/forms/:formId/verify-funding", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const { transactionId } = request.body as Partial<{ transactionId: string }>;
    const formConfig = getFormConfig(formId);

    if (!formConfig) {
      return reply.status(404).send({ error: "form not configured yet" });
    }
    if (typeof transactionId !== "string" || transactionId === "") {
      return reply.status(400).send({ error: "transactionId is required" });
    }

    const potTinybar = BigInt(formConfig.pricePerResponseTinybar) * BigInt(formConfig.maxResponses);
    const verified = await verifyIncomingHbarTransfer(transactionId, config.hederaAccountId, potTinybar);

    if (!verified) {
      return reply.status(422).send({
        error: `Mirror Node doesn't show a transfer of at least ${potTinybar} tinybars to ${config.hederaAccountId} for that transaction id`,
      });
    }

    const updated = markFunded(formId, transactionId);
    return reply.send(updated);
  });

  app.get("/forms/:formId/stats", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const formConfig = getFormConfig(formId);
    if (!formConfig) {
      return reply.status(404).send({ error: "form not configured yet" });
    }

    const responses = getResponsesForForm(formId);
    const approved = responses.filter((r) => r.verdict.decision === "APPROVE").length;
    const rejected = responses.filter((r) => r.verdict.decision === "REJECT").length;
    const spentTinybar = BigInt(formConfig.pricePerResponseTinybar) * BigInt(approved);
    const potTinybar = BigInt(formConfig.pricePerResponseTinybar) * BigInt(formConfig.maxResponses);

    return reply.send({
      formId,
      pricePerResponseTinybar: formConfig.pricePerResponseTinybar,
      maxResponses: formConfig.maxResponses,
      funded: formConfig.funded,
      fundingTransactionId: formConfig.fundingTransactionId,
      received: responses.length,
      approved,
      rejected,
      remainingResponses: Math.max(0, formConfig.maxResponses - approved),
      potTinybar: potTinybar.toString(),
      remainingBudgetTinybar: (potTinybar - spentTinybar).toString(),
    });
  });

  app.get("/forms/:formId/responses/:responseId", async (request, reply) => {
    const { formId, responseId } = request.params as { formId: string; responseId: string };
    const response = getResponse(formId, responseId);
    if (!response) {
      return reply.status(404).send({ error: "response not found" });
    }
    return reply.send({
      formId,
      responseId,
      decision: response.verdict.decision,
      claimed: response.claimed,
    });
  });

  app.post("/forms/:formId/world-rp-signature", async (request) => {
    const { formId } = request.params as { formId: string };
    const action = claimAction(formId);
    return { ...getRpSignature(action), action };
  });

  app.post("/forms/:formId/responses/:responseId/claim", async (request, reply) => {
    const { formId, responseId } = request.params as { formId: string; responseId: string };
    const idkitResponse = request.body as IdKitVerifyPayload;

    try {
      const result = await processClaim(formId, responseId, idkitResponse);
      return reply.send({ success: true, ...result });
    } catch (err) {
      if (err instanceof ClaimError) {
        return reply.status(err.status).send({ error: err.message });
      }
      request.log.error(err, "processClaim failed");
      return reply.status(500).send({ error: "claim failed" });
    }
  });

  // TODO (Day 4+): anchor the verdict to HCS for a tamper-proof audit trail.

  return app;
}
