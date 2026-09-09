import Fastify from "fastify";
import { parseFormSubmissionPayload } from "./validate.js";
import { handleFormSubmit } from "./webhook.js";

export function buildServer() {
  const app = Fastify({ logger: true });

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

  // TODO (Day 3+): on APPROVE, send the claim email; anchor the verdict to
  // HCS; wire the real LLM judgment into resource-server (currently stubbed).

  return app;
}
