/**
 * Inlined as a TS string rather than a sibling .sql file loaded at
 * runtime — `tsc`'s build doesn't copy non-TS assets into dist/, and this
 * is a one-time migration script, not hot-path code, so there's no
 * readability cost worth trading for a "forgot to copy the .sql file into
 * the production build" class of bug.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS forms (
  form_id TEXT PRIMARY KEY,
  price_per_response_tinybar TEXT NOT NULL,
  max_responses INTEGER NOT NULL,
  created_at_iso TEXT NOT NULL,
  funded BOOLEAN NOT NULL DEFAULT FALSE,
  funding_transaction_id TEXT
);

CREATE TABLE IF NOT EXISTS responses (
  form_id TEXT NOT NULL,
  response_id TEXT NOT NULL,
  respondent_email TEXT NOT NULL,
  submitted_at_iso TEXT NOT NULL,
  time_spent_seconds INTEGER,
  answers JSONB NOT NULL,
  decision TEXT NOT NULL,
  flags JSONB NOT NULL,
  reasoning TEXT NOT NULL,
  confidence REAL NOT NULL,
  model_id TEXT NOT NULL,
  verified_at_iso TEXT NOT NULL,
  x402_transaction_id TEXT,
  received_at_iso TEXT NOT NULL,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  payout_transaction_id TEXT,
  hcs_transaction_id TEXT,
  hcs_sequence_number TEXT,
  PRIMARY KEY (form_id, response_id)
);

-- The actual enforcement of "one payout per real human per form" — a
-- unique constraint the database itself guarantees, not just application
-- code, so it holds even across concurrent requests or multiple instances.
CREATE TABLE IF NOT EXISTS used_nullifiers (
  nullifier TEXT NOT NULL,
  action TEXT NOT NULL,
  used_at_iso TEXT NOT NULL DEFAULT now()::text,
  PRIMARY KEY (nullifier, action)
);
`;
