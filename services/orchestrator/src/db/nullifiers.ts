import { pool } from "./client.js";

export async function isNullifierUsed(nullifier: string, action: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT 1 FROM used_nullifiers WHERE nullifier = $1 AND action = $2 LIMIT 1",
    [nullifier, action],
  );
  return rows.length > 0;
}

/** Idempotent — the (nullifier, action) primary key means a repeat call is a no-op, matching the old Set's semantics. */
export async function markNullifierUsed(nullifier: string, action: string): Promise<void> {
  await pool.query(
    "INSERT INTO used_nullifiers (nullifier, action) VALUES ($1, $2) ON CONFLICT (nullifier, action) DO NOTHING",
    [nullifier, action],
  );
}
