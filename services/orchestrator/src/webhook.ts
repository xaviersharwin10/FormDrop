import type { FormSubmissionPayload, VerificationVerdict, VerifyRequestBody } from "@formdrop/shared";
import { config } from "./config.js";
import { fetchWithPayment, httpClient } from "./x402Client.js";
import { getResponsesForForm, recordResponse } from "./responseStore.js";
import { sendClaimEmail } from "./email.js";

export interface FormSubmitResult {
  verdict: VerificationVerdict;
  x402TransactionId: string | null;
}

const MAX_PRIOR_ANSWERS_FOR_DUPLICATE_CHECK = 20;

function summarizeAnswers(answers: Record<string, string>): string {
  return Object.values(answers).join(" | ");
}

/**
 * Pays resource-server via x402 for a verification verdict on one form
 * response, then records the result. This is the paying-client half of the
 * Hedera track requirement — the resource-server half is the /verify route
 * it's calling here.
 */
export async function handleFormSubmit(payload: FormSubmissionPayload): Promise<FormSubmitResult> {
  const priorAnswerTexts = getResponsesForForm(payload.formId)
    .slice(-MAX_PRIOR_ANSWERS_FOR_DUPLICATE_CHECK)
    .map((r) => summarizeAnswers(r.payload.answers));

  const requestBody: VerifyRequestBody = { payload, priorAnswerTexts };

  const response = await fetchWithPayment(`${config.resourceServerUrl}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`resource-server /verify failed: HTTP ${response.status} ${await response.text()}`);
  }

  const verdict = (await response.json()) as VerificationVerdict;
  const settlement = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));

  recordResponse({
    payload,
    verdict,
    x402TransactionId: settlement?.transaction ?? null,
    receivedAtIso: new Date().toISOString(),
  });

  if (verdict.decision === "APPROVE") {
    // Fire-and-forget: an email failure shouldn't fail a webhook whose
    // payment already settled and whose verdict is already recorded.
    sendClaimEmail(payload).catch((err) => console.error("sendClaimEmail threw:", err));
  }

  return { verdict, x402TransactionId: settlement?.transaction ?? null };
}
