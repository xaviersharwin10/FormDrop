import { encodeFunctionData } from "viem";

/**
 * 1 tinybar = 10,000,000,000 weibar — Hedera's JSON-RPC relay speaks in
 * weibar (the same 18-decimal scale real Ethereum tooling assumes) and
 * converts down to tinybars for actual settlement, so a raw EVM
 * transaction's `value` field must be scaled up by this factor to send an
 * exact tinybar amount. See README's escrow section for how this was
 * confirmed against a real testnet transaction.
 */
export const TINYBAR_TO_WEIBAR = BigInt(10_000_000_000);

export function tinybarToWeibar(tinybar: string | bigint): bigint {
  return BigInt(tinybar) * TINYBAR_TO_WEIBAR;
}

const FUND_POT_ABI = [
  {
    type: "function",
    name: "fundPot",
    stateMutability: "payable",
    inputs: [{ name: "formId", type: "string" }],
    outputs: [],
  },
] as const;

export function encodeFundPotCalldata(formId: string): `0x${string}` {
  return encodeFunctionData({ abi: FUND_POT_ABI, functionName: "fundPot", args: [formId] });
}
