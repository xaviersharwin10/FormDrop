import Fastify from "fastify";

export function buildServer() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // TODO (Day 2): POST /webhook/form-submit — receives the Apps Script
  // onFormSubmit payload, calls resource-server's /verify via fetchWithPayment,
  // anchors the verdict to HCS, and (Day 3+) triggers the claim email / payout.

  return app;
}
