import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { FormSubmissionPayload, VerificationVerdict } from "@formdrop/shared";
import { config } from "./config.js";

const MODEL_ID = "gemini-3.6-flash";

const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

const VerdictSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  flags: z.object({
    isGibberish: z.boolean(),
    isDuplicateOrNearDuplicate: z.boolean(),
    isLikelyLLMBoilerplate: z.boolean(),
    isSuspiciouslyFast: z.boolean(),
  }),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const RESPONSE_JSON_SCHEMA = z.toJSONSchema(VerdictSchema);

const SYSTEM_PROMPT = `You judge one Google Form response to decide whether the respondent should be paid.
This is a real gate on real money — the respondent is paid the instant you approve, so your call is the
only thing standing between a genuine participant and someone farming a payout pot with junk answers.

Decide APPROVE or REJECT based on:
- Is this a genuine, considered answer — not gibberish, keyboard-mashing, or a one-word non-answer where
  detail was clearly expected?
- Does it look like a duplicate or near-duplicate of a prior response to the same form (copy-paste
  farming)? You're given recent prior answers for comparison.
- Does it read as obviously LLM-generated boilerplate where genuine personal reflection was asked for —
  generic, hedge-everything phrasing with no specific detail a real person in this situation would give?
- If a time-to-complete is given: answering a multi-question form in a couple of seconds is a red flag
  regardless of how good the text looks.

Default to APPROVE for genuine, low-effort-but-real answers — this is an anti-fraud gate, not a quality
bar. Only REJECT when you'd actually bet money it's fraudulent or not a real answer. Explain your
reasoning concretely, citing what in THIS response drove the decision.`;

function formatAnswers(answers: Record<string, string>): string {
  return Object.entries(answers)
    .map(([question, answer]) => `Q: ${question}\nA: ${answer}`)
    .join("\n\n");
}

export async function runVerification(
  payload: FormSubmissionPayload,
  priorAnswerTexts: string[],
): Promise<VerificationVerdict> {
  const userMessage = [
    `Response to judge (responseId: ${payload.responseId}):`,
    formatAnswers(payload.answers),
    payload.timeSpentSeconds !== undefined
      ? `\nTime to complete: ${payload.timeSpentSeconds} seconds.`
      : "\nTime to complete: not available.",
    priorAnswerTexts.length > 0
      ? `\nUp to ${priorAnswerTexts.length} prior response(s) to this same form, for duplicate comparison:\n` +
        priorAnswerTexts.map((text, i) => `[${i + 1}] ${text}`).join("\n")
      : "\nNo prior responses to this form yet — duplicate check trivially passes.",
  ].join("\n");

  const response = await client.models.generateContent({
    model: MODEL_ID,
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_JSON_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini verification call returned no text");
  }

  const parsed = VerdictSchema.parse(JSON.parse(text));

  return {
    ...parsed,
    modelId: MODEL_ID,
    verifiedAtIso: new Date().toISOString(),
  };
}
