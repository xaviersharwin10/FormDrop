/**
 * Day-1 spike: prove one real x402 payment settles end-to-end on Hedera
 * testnet via Blocky402, before building anything else on top of it.
 *
 * Run: pnpm --filter @formdrop/orchestrator spike
 * (requires services/resource-server running locally, and both services'
 * .env files filled in with real Hedera testnet credentials)
 */
import type { FormSubmissionPayload, VerificationVerdict, VerifyRequestBody } from "@formdrop/shared";
import { config } from "./config.js";
import { fetchWithPayment, httpClient } from "./x402Client.js";

async function main() {
  const dummyPayload: FormSubmissionPayload = {
    formId: "spike-form",
    responseId: `spike-${Date.now()}`,
    respondentEmail: "spike@example.com",
    submittedAtIso: new Date().toISOString(),
    answers: { "How was your experience?": "Genuinely helpful, would use again." },
  };
  const requestBody: VerifyRequestBody = { payload: dummyPayload, priorAnswerTexts: [] };

  console.log(`Calling ${config.resourceServerUrl}/verify (expect a 402, then a paid retry)...`);

  const response = await fetchWithPayment(`${config.resourceServerUrl}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const paymentRequiredHeader = response.headers.get("payment-required");
    if (paymentRequiredHeader) {
      console.error(
        "Decoded payment-required header:",
        JSON.stringify(JSON.parse(Buffer.from(paymentRequiredHeader, "base64").toString()), null, 2),
      );
    }
    throw new Error(`Request failed after payment: HTTP ${response.status} ${await response.text()}`);
  }

  const verdict = (await response.json()) as VerificationVerdict;
  const settlement = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));

  console.log("Verdict:", verdict);
  console.log("Settlement:", settlement);
  console.log(`\nSpike succeeded — real x402 payment settled on ${config.hederaNetwork}.`);
}

main().catch((err) => {
  console.error("Spike failed:", err);
  process.exit(1);
});
