import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import solc from "solc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CompiledContract {
  abi: unknown[];
  bytecode: string;
}

/** Compiles contracts/FormDropEscrow.sol fresh every time — no build cache to go stale. */
export function compileEscrowContract(): CompiledContract {
  const contractPath = path.join(__dirname, "..", "contracts", "FormDropEscrow.sol");
  const source = readFileSync(contractPath, "utf8");

  const input = {
    language: "Solidity",
    sources: { "FormDropEscrow.sol": { content: source } },
    settings: {
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      optimizer: { enabled: true, runs: 200 },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Solidity compile failed:\n${errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n")}`);
  }

  const contract = output.contracts["FormDropEscrow.sol"]["FormDropEscrow"];
  return { abi: contract.abi, bytecode: contract.evm.bytecode.object };
}
