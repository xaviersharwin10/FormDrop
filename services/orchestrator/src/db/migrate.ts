/**
 * One-time (and idempotent — safe to re-run) schema setup.
 * Run: pnpm db:migrate
 */
import { pool } from "./client.js";
import { SCHEMA_SQL } from "./schema.js";

async function main() {
  await pool.query(SCHEMA_SQL);
  console.log("Schema applied: forms, responses, used_nullifiers.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
