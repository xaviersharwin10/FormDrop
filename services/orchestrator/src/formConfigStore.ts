/**
 * In-memory placeholder — same caveat as responseStore.ts, replaced by
 * packages/db once persistence actually needs to survive a restart.
 */
export interface FormConfig {
  formId: string;
  pricePerResponseTinybar: string;
  maxResponses: number;
  createdAtIso: string;
  funded: boolean;
  fundingTransactionId: string | null;
}

const configs = new Map<string, FormConfig>();

export function setFormConfig(
  config: Omit<FormConfig, "funded" | "fundingTransactionId">,
): FormConfig {
  const existing = configs.get(config.formId);
  const full: FormConfig = {
    ...config,
    funded: existing?.funded ?? false,
    fundingTransactionId: existing?.fundingTransactionId ?? null,
  };
  configs.set(config.formId, full);
  return full;
}

export function getFormConfig(formId: string): FormConfig | undefined {
  return configs.get(formId);
}

export function markFunded(formId: string, transactionId: string): FormConfig | undefined {
  const existing = configs.get(formId);
  if (!existing) return undefined;
  const updated: FormConfig = { ...existing, funded: true, fundingTransactionId: transactionId };
  configs.set(formId, updated);
  return updated;
}
