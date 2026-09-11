import type { FormSubmissionPayload, VerificationVerdict } from "@formdrop/shared";
import { pool } from "./client.js";

export interface StoredResponse {
  payload: FormSubmissionPayload;
  verdict: VerificationVerdict;
  x402TransactionId: string | null;
  receivedAtIso: string;
  claimed: boolean;
  payoutTransactionId: string | null;
  hcsTransactionId: string | null;
  hcsSequenceNumber: string | null;
}

interface ResponseRow {
  form_id: string;
  response_id: string;
  respondent_email: string;
  submitted_at_iso: string;
  time_spent_seconds: number | null;
  answers: Record<string, string>;
  decision: "APPROVE" | "REJECT";
  flags: VerificationVerdict["flags"];
  reasoning: string;
  confidence: number;
  model_id: string;
  verified_at_iso: string;
  x402_transaction_id: string | null;
  received_at_iso: string;
  claimed: boolean;
  payout_transaction_id: string | null;
  hcs_transaction_id: string | null;
  hcs_sequence_number: string | null;
}

function fromRow(row: ResponseRow): StoredResponse {
  return {
    payload: {
      formId: row.form_id,
      responseId: row.response_id,
      respondentEmail: row.respondent_email,
      submittedAtIso: row.submitted_at_iso,
      timeSpentSeconds: row.time_spent_seconds ?? undefined,
      answers: row.answers,
    },
    verdict: {
      decision: row.decision,
      flags: row.flags,
      reasoning: row.reasoning,
      confidence: row.confidence,
      modelId: row.model_id,
      verifiedAtIso: row.verified_at_iso,
    },
    x402TransactionId: row.x402_transaction_id,
    receivedAtIso: row.received_at_iso,
    claimed: row.claimed,
    payoutTransactionId: row.payout_transaction_id,
    hcsTransactionId: row.hcs_transaction_id,
    hcsSequenceNumber: row.hcs_sequence_number,
  };
}

export async function recordResponse(
  entry: Omit<StoredResponse, "claimed" | "payoutTransactionId" | "hcsTransactionId" | "hcsSequenceNumber">,
): Promise<void> {
  await pool.query(
    `INSERT INTO responses (
       form_id, response_id, respondent_email, submitted_at_iso, time_spent_seconds, answers,
       decision, flags, reasoning, confidence, model_id, verified_at_iso,
       x402_transaction_id, received_at_iso
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (form_id, response_id) DO NOTHING`,
    [
      entry.payload.formId,
      entry.payload.responseId,
      entry.payload.respondentEmail,
      entry.payload.submittedAtIso,
      entry.payload.timeSpentSeconds ?? null,
      JSON.stringify(entry.payload.answers),
      entry.verdict.decision,
      JSON.stringify(entry.verdict.flags),
      entry.verdict.reasoning,
      entry.verdict.confidence,
      entry.verdict.modelId,
      entry.verdict.verifiedAtIso,
      entry.x402TransactionId,
      entry.receivedAtIso,
    ],
  );
}

export async function getResponsesForForm(formId: string): Promise<StoredResponse[]> {
  const { rows } = await pool.query<ResponseRow>(
    "SELECT * FROM responses WHERE form_id = $1 ORDER BY received_at_iso ASC",
    [formId],
  );
  return rows.map(fromRow);
}

export async function getResponse(formId: string, responseId: string): Promise<StoredResponse | undefined> {
  const { rows } = await pool.query<ResponseRow>(
    "SELECT * FROM responses WHERE form_id = $1 AND response_id = $2",
    [formId, responseId],
  );
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export async function markClaimed(formId: string, responseId: string, payoutTransactionId: string): Promise<void> {
  await pool.query(
    "UPDATE responses SET claimed = TRUE, payout_transaction_id = $3 WHERE form_id = $1 AND response_id = $2",
    [formId, responseId, payoutTransactionId],
  );
}

export async function setHcsAudit(
  formId: string,
  responseId: string,
  hcsTransactionId: string,
  hcsSequenceNumber: string,
): Promise<void> {
  await pool.query(
    "UPDATE responses SET hcs_transaction_id = $3, hcs_sequence_number = $4 WHERE form_id = $1 AND response_id = $2",
    [formId, responseId, hcsTransactionId, hcsSequenceNumber],
  );
}
