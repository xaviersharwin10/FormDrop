import { Pool } from "pg";
import { config } from "../config.js";

/**
 * Real Postgres persistence (Supabase, Neon, or any provider's connection
 * string), replacing the earlier in-memory *Store.ts placeholders — those
 * were explicitly documented as "lost on every restart," which repeatedly
 * bit us during live testing (form config, response history, and the
 * World ID nullifier record all vanished on every dev restart). A real
 * deployment redeploys, cold-starts, and can scale to multiple instances,
 * all of which would hit the same loss, so this isn't optional for
 * anything beyond a single uninterrupted local demo.
 */
export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
});
