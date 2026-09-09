import type { FormSubmissionPayload, VerificationVerdict } from "@formdrop/shared";

/**
 * In-memory placeholder — packages/db (Postgres) replaces this once the
 * creator dashboard and duplicate-detection logic need real persistence.
 * Fine for proving the pipeline end to end; lost on every restart.
 */
export interface StoredResponse {
  payload: FormSubmissionPayload;
  verdict: VerificationVerdict;
  x402TransactionId: string | null;
  receivedAtIso: string;
  claimed: boolean;
  payoutTransactionId: string | null;
}

const responsesByForm = new Map<string, StoredResponse[]>();

export function recordResponse(entry: Omit<StoredResponse, "claimed" | "payoutTransactionId">): void {
  const existing = responsesByForm.get(entry.payload.formId) ?? [];
  existing.push({ ...entry, claimed: false, payoutTransactionId: null });
  responsesByForm.set(entry.payload.formId, existing);
}

export function getResponsesForForm(formId: string): StoredResponse[] {
  return responsesByForm.get(formId) ?? [];
}

export function getResponse(formId: string, responseId: string): StoredResponse | undefined {
  return getResponsesForForm(formId).find((r) => r.payload.responseId === responseId);
}

export function markClaimed(formId: string, responseId: string, payoutTransactionId: string): void {
  const response = getResponse(formId, responseId);
  if (response) {
    response.claimed = true;
    response.payoutTransactionId = payoutTransactionId;
  }
}
