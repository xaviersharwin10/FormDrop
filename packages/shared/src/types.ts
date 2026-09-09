/** Payload POSTed by the Apps Script onFormSubmit trigger to the orchestrator. */
export interface FormSubmissionPayload {
  formId: string;
  responseId: string;
  respondentEmail: string;
  submittedAtIso: string;
  /** Seconds between form open and submit, when Apps Script can determine it. */
  timeSpentSeconds?: number;
  /** Question title -> respondent's answer, in the order Apps Script reports them. */
  answers: Record<string, string>;
}

export type VerificationDecision = "APPROVE" | "REJECT";

export interface VerificationFlags {
  isGibberish: boolean;
  isDuplicateOrNearDuplicate: boolean;
  isLikelyLLMBoilerplate: boolean;
  isSuspiciouslyFast: boolean;
}

/** The agent's verdict on one form response, including its reasoning trail. */
export interface VerificationVerdict {
  decision: VerificationDecision;
  flags: VerificationFlags;
  /** Free-text reasoning from the LLM call — shown in the demo, logged for the audit trail. */
  reasoning: string;
  /** 0-1 confidence the LLM assigns its own decision. */
  confidence: number;
  modelId: string;
  verifiedAtIso: string;
}

/** What gets anchored to HCS as the tamper-proof audit record. */
export interface AuditRecord {
  formId: string;
  responseId: string;
  /** Hash of the response payload, not the raw payload, to keep HCS messages small and avoid putting PII on a public ledger. */
  responsePayloadHash: string;
  verdict: VerificationVerdict;
  x402PaymentTransactionId: string;
}
