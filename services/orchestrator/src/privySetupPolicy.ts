/**
 * One-time setup: creates the policy applied to every respondent payout
 * wallet. This is the explicit "Privy control" the Best B2B / Best
 * financial flow tracks require beyond just using embedded wallets —
 * denies every wallet method by default, since these wallets are
 * provisioned server-side with nobody present to authorize a spend; they
 * exist purely to receive one payout.
 *
 * Run once: pnpm privy:setup-policy
 * Then paste the printed policy id into services/orchestrator/.env as
 * PRIVY_RESPONDENT_POLICY_ID.
 */
import { privy } from "./privy.js";

async function main() {
  const policy = await privy.policies().create({
    chain_type: "ethereum",
    name: "formdrop-respondent-receive-only",
    version: "1.0",
    rules: [
      {
        name: "deny-everything",
        method: "*",
        action: "DENY",
        conditions: [],
      },
    ],
  });

  console.log("Created policy:", policy.id);
  console.log("\nAdd this to services/orchestrator/.env:");
  console.log(`PRIVY_RESPONDENT_POLICY_ID=${policy.id}`);
}

main().catch((err) => {
  console.error("Policy setup failed:", err);
  process.exit(1);
});
