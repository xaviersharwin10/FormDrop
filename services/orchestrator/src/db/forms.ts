import { pool } from "./client.js";

export interface FormConfig {
  formId: string;
  pricePerResponseTinybar: string;
  maxResponses: number;
  createdAtIso: string;
  funded: boolean;
  fundingTransactionId: string | null;
}

interface FormRow {
  form_id: string;
  price_per_response_tinybar: string;
  max_responses: number;
  created_at_iso: string;
  funded: boolean;
  funding_transaction_id: string | null;
}

function fromRow(row: FormRow): FormConfig {
  return {
    formId: row.form_id,
    pricePerResponseTinybar: row.price_per_response_tinybar,
    maxResponses: row.max_responses,
    createdAtIso: row.created_at_iso,
    funded: row.funded,
    fundingTransactionId: row.funding_transaction_id,
  };
}

/** Upserts the form's price/max-responses; preserves existing funded status on re-save (matches the prior in-memory behavior). */
export async function setFormConfig(
  input: Omit<FormConfig, "funded" | "fundingTransactionId">,
): Promise<FormConfig> {
  const { rows } = await pool.query<FormRow>(
    `INSERT INTO forms (form_id, price_per_response_tinybar, max_responses, created_at_iso)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (form_id) DO UPDATE SET
       price_per_response_tinybar = EXCLUDED.price_per_response_tinybar,
       max_responses = EXCLUDED.max_responses
     RETURNING *`,
    [input.formId, input.pricePerResponseTinybar, input.maxResponses, input.createdAtIso],
  );
  return fromRow(rows[0]);
}

export async function getFormConfig(formId: string): Promise<FormConfig | undefined> {
  const { rows } = await pool.query<FormRow>("SELECT * FROM forms WHERE form_id = $1", [formId]);
  return rows[0] ? fromRow(rows[0]) : undefined;
}

export async function markFunded(formId: string, transactionId: string): Promise<FormConfig | undefined> {
  const { rows } = await pool.query<FormRow>(
    `UPDATE forms SET funded = TRUE, funding_transaction_id = $2 WHERE form_id = $1 RETURNING *`,
    [formId, transactionId],
  );
  return rows[0] ? fromRow(rows[0]) : undefined;
}
