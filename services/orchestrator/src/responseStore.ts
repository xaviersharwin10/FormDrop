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
}

const responsesByForm = new Map<string, StoredResponse[]>();

export function recordResponse(entry: StoredResponse): void {
  const existing = responsesByForm.get(entry.payload.formId) ?? [];
  existing.push(entry);
  responsesByForm.set(entry.payload.formId, existing);
}

export function getResponsesForForm(formId: string): StoredResponse[] {
  return responsesByForm.get(formId) ?? [];
}
