const BASE_URL = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4002";

export interface FormStats {
  formId: string;
  pricePerResponseTinybar: string;
  maxResponses: number;
  funded: boolean;
  fundingTransactionId: string | null;
  received: number;
  approved: number;
  rejected: number;
  remainingResponses: number;
  potTinybar: string;
  remainingBudgetTinybar: string;
}

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed: HTTP ${res.status}`);
  }
  return body as T;
}

export function saveFormConfig(input: {
  formId: string;
  pricePerResponseTinybar: string;
  maxResponses: number;
  creatorId: string;
}) {
  return fetch(`${BASE_URL}/forms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => asJson<FormStats>(res));
}

export function getFormsForCreator(creatorId: string) {
  return fetch(`${BASE_URL}/creators/${encodeURIComponent(creatorId)}/forms`).then((res) =>
    asJson<FormStats[]>(res),
  );
}

export function getTreasuryAccountId(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/treasury`).then((res) =>
    asJson<{ treasuryAccountId: string; usdcTokenId: string; usdCentsPerHbar: number }>(res),
  );
}

export type FundingAsset = "HBAR" | "USDC";

export function verifyFunding(formId: string, transactionId: string, asset: FundingAsset) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/verify-funding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId, asset }),
  }).then((res) => asJson<FormStats>(res));
}

export function createFundingCheckoutSession(formId: string, successUrl: string, cancelUrl: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/fund/checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ successUrl, cancelUrl }),
  }).then((res) => asJson<{ url: string }>(res));
}

export function getCreatorPrivyWallet(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/privy-wallet`).then((res) =>
    asJson<{ address: string; balanceTinybar: string }>(res),
  );
}

export function fundPotFromPrivyWallet(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/fund/privy-transfer`, {
    method: "POST",
  }).then((res) => asJson<FormStats>(res));
}

export function getStats(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/stats`).then((res) =>
    asJson<FormStats>(res),
  );
}

export interface FormResponseSummary {
  responseId: string;
  respondentEmail: string;
  submittedAtIso: string;
  decision: "APPROVE" | "REJECT";
  confidence: number;
  reasoning: string;
  x402TransactionId: string | null;
  claimed: boolean;
  payoutTransactionId: string | null;
  hcsTransactionId: string | null;
  hcsSequenceNumber: string | null;
  lastClaimError: string | null;
  lastClaimAttemptIso: string | null;
}

export function getResponses(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/responses`).then((res) =>
    asJson<FormResponseSummary[]>(res),
  );
}

export interface RpSignatureBundle {
  app_id: `app_${string}`;
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
  environment: "production" | "staging" | "sandbox";
  action: string;
}

export interface ResponseStatus {
  formId: string;
  responseId: string;
  decision: "APPROVE" | "REJECT";
  claimed: boolean;
  pricePerResponseTinybar: string | null;
}

export interface ClaimResult {
  success: true;
  payoutTransactionId: string;
  walletAddress: string;
}

export function getResponseStatus(formId: string, responseId: string) {
  return fetch(
    `${BASE_URL}/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}`,
  ).then((res) => asJson<ResponseStatus>(res));
}

export function getWorldRpSignature(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/world-rp-signature`, {
    method: "POST",
  }).then((res) => asJson<RpSignatureBundle>(res));
}

export function submitClaim(formId: string, responseId: string, idkitResponse: unknown) {
  return fetch(
    `${BASE_URL}/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}/claim`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(idkitResponse),
    },
  ).then((res) => asJson<ClaimResult>(res));
}

export function tinybarToHbar(tinybar: string): string {
  return (Number(BigInt(tinybar)) / 1e8).toString();
}

export function hbarToTinybar(hbar: string): string {
  return String(BigInt(Math.round(Number(hbar) * 1e8)));
}

/** Full URL to redirect the browser to for Google's OAuth consent screen — not a fetch, a navigation target. */
export function googleAuthStartUrl(creatorId: string): string {
  return `${BASE_URL}/auth/google/start?creatorId=${encodeURIComponent(creatorId)}`;
}

export function getGoogleAccountStatus(creatorId: string) {
  return fetch(`${BASE_URL}/creators/${encodeURIComponent(creatorId)}/google-account`).then((res) =>
    asJson<{ connected: boolean; googleEmail: string | null }>(res),
  );
}

export function registerFormWatch(formId: string, creatorId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/watch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creatorId }),
  }).then((res) => asJson<{ formId: string; watchId: string; expireTimeIso: string }>(res));
}

export function getFormWatchStatus(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/watch`).then((res) =>
    asJson<{ watching: boolean; expireTimeIso: string | null }>(res),
  );
}
