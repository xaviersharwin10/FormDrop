import type { FormSubmissionPayload, VerificationVerdict } from "@formdrop/shared";
import { config } from "./config.js";
import { fetchWithPayment, httpClient } from "./x402Client.js";
import { recordResponse } from "./responseStore.js";

export interface FormSubmitResult {
  verdict: VerificationVerdict;
  x402TransactionId: string | null;
}

/**
 * Pays resource-server via x402 for a verification verdict on one form
 * response, then records the result. This is the paying-client half of the
 * Hedera track requirement — the resource-server half is the /verify route
 * it's calling here.
 */
export async function handleFormSubmit(payload: FormSubmissionPayload): Promise<FormSubmitResult> {
  const response = await fetchWithPayment(`${config.resourceServerUrl}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

  return { verdict, x402TransactionId: settlement?.transaction ?? null };
}
