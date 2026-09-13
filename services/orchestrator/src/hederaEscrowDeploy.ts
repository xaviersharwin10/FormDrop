import "dotenv/config";
import { compileEscrowContract } from "./compileEscrow.js";
import { deployEscrowContract } from "./hederaEscrow.js";

async function main() {
  console.log("Compiling FormDropEscrow.sol...");
  const { bytecode } = compileEscrowContract();

  console.log("Deploying to Hedera testnet...");
  const contractId = await deployEscrowContract(bytecode);

  console.log(`\nDeployed. Add this to .env (and Render):\n\nESCROW_CONTRACT_ID=${contractId}\n`);
}

main().catch((err) => {
  console.error("Escrow deployment failed:", err);
  process.exit(1);
});
