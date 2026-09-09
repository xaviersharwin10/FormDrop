import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const config = {
  hederaAccountId: requireEnv("HEDERA_ACCOUNT_ID"),
  hederaPrivateKey: requireEnv("HEDERA_PRIVATE_KEY"),
  hederaNetwork: process.env.HEDERA_NETWORK ?? "hedera:testnet",
  resourceServerUrl: process.env.RESOURCE_SERVER_URL ?? "http://localhost:4001",
  port: Number(process.env.PORT ?? 4002),
};
