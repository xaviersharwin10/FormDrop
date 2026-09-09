import type { FormSubmissionPayload } from "@formdrop/shared";

/**
 * Minimal shape validation before we spend a paid x402 call on it — no
 * point paying resource-server to judge a malformed payload.
 */
export function parseFormSubmissionPayload(body: unknown): FormSubmissionPayload {
  if (typeof body !== "object" || body === null) {
    throw new Error("Body must be an object");
  }
  const b = body as Record<string, unknown>;

  for (const field of ["formId", "responseId", "respondentEmail", "submittedAtIso"]) {
    if (typeof b[field] !== "string" || b[field] === "") {
      throw new Error(`Missing or invalid required field: ${field}`);
    }
  }

  if (typeof b.answers !== "object" || b.answers === null || Array.isArray(b.answers)) {
    throw new Error("Missing or invalid required field: answers");
  }
  for (const value of Object.values(b.answers as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new Error("answers must map question titles to string answers");
    }
  }

  return {
    formId: b.formId as string,
    responseId: b.responseId as string,
    respondentEmail: b.respondentEmail as string,
    submittedAtIso: b.submittedAtIso as string,
    timeSpentSeconds: typeof b.timeSpentSeconds === "number" ? b.timeSpentSeconds : undefined,
    answers: b.answers as Record<string, string>,
  };
}
