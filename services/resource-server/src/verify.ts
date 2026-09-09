import type { FormSubmissionPayload, VerificationVerdict } from "@formdrop/shared";

/**
 * Stub verdict logic — always approves. Placeholder to prove the x402-gated
 * endpoint end-to-end before the real LLM judgment call replaces this.
 */
export async function runVerification(
  payload: FormSubmissionPayload,
): Promise<VerificationVerdict> {
  return {
    decision: "APPROVE",
    flags: {
      isGibberish: false,
      isDuplicateOrNearDuplicate: false,
      isLikelyLLMBoilerplate: false,
      isSuspiciouslyFast: false,
    },
    reasoning: `Stub verdict: response ${payload.responseId} auto-approved (LLM judgment not yet wired up).`,
    confidence: 0,
    modelId: "stub",
    verifiedAtIso: new Date().toISOString(),
  };
}
