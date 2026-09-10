/**
 * One-time setup: creates the HCS topic every verification verdict gets
 * anchored to (see hcs.ts).
 *
 * Run once: pnpm hcs:setup-topic
 * Then paste the printed topic id into services/orchestrator/.env as
 * HCS_AUDIT_TOPIC_ID.
 */
import { createAuditTopic } from "./hcs.js";

async function main() {
  const topicId = await createAuditTopic();
  console.log("Created HCS topic:", topicId);
  console.log("\nAdd this to services/orchestrator/.env:");
  console.log(`HCS_AUDIT_TOPIC_ID=${topicId}`);
}

main().catch((err) => {
  console.error("HCS topic setup failed:", err);
  process.exit(1);
});
