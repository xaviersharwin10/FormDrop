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
}) {
  return fetch(`${BASE_URL}/forms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => asJson<FormStats>(res));
}

export function getTreasuryAccountId(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/treasury`).then((res) =>
    asJson<{ treasuryAccountId: string }>(res),
  );
}

export function verifyFunding(formId: string, transactionId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/verify-funding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactionId }),
  }).then((res) => asJson<FormStats>(res));
}

export function getStats(formId: string) {
  return fetch(`${BASE_URL}/forms/${encodeURIComponent(formId)}/stats`).then((res) =>
    asJson<FormStats>(res),
  );
}

export function tinybarToHbar(tinybar: string): string {
  return (Number(BigInt(tinybar)) / 1e8).toString();
}

export function hbarToTinybar(hbar: string): string {
  return String(BigInt(Math.round(Number(hbar) * 1e8)));
}
