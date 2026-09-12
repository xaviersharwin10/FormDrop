import { requireGoogleFormsConfig } from "./config.js";

const FORMS_API_BASE = "https://forms.googleapis.com/v1";

async function formsFetch(url: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Forms API request failed: HTTP ${res.status} ${await res.text()} (${url})`);
  }
  return res;
}

/** questionId -> human-readable question title, needed since FormResponse.answers is keyed by questionId. */
export async function getQuestionTitles(formId: string, accessToken: string): Promise<Map<string, string>> {
  const res = await formsFetch(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}`, accessToken);
  const form = (await res.json()) as {
    items?: Array<{ title?: string; questionItem?: { question?: { questionId?: string } } }>;
  };
  const titles = new Map<string, string>();
  for (const item of form.items ?? []) {
    const questionId = item.questionItem?.question?.questionId;
    if (questionId && item.title) titles.set(questionId, item.title);
  }
  return titles;
}

export interface RawFormResponse {
  responseId: string;
  createTime: string;
  respondentEmail?: string;
  answers?: Record<string, { textAnswers?: { answers?: Array<{ value?: string }> } }>;
}

/** Only responses submitted strictly after `sinceIso` — the actual mechanism that makes polling on every notification cheap. */
export async function listNewResponses(
  formId: string,
  accessToken: string,
  sinceIso: string,
): Promise<RawFormResponse[]> {
  const url = new URL(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/responses`);
  url.searchParams.set("filter", `timestamp > ${sinceIso}`);
  const res = await formsFetch(url.toString(), accessToken);
  const data = (await res.json()) as { responses?: RawFormResponse[] };
  return data.responses ?? [];
}

export interface WatchResult {
  id: string;
  expireTime: string;
}

export async function createResponsesWatch(formId: string, accessToken: string): Promise<WatchResult> {
  const { googlePubsubTopic } = requireGoogleFormsConfig();
  const res = await formsFetch(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      watch: {
        target: { topic: { topicName: googlePubsubTopic } },
        eventType: "RESPONSES",
      },
    }),
  });
  return (await res.json()) as WatchResult;
}

export async function renewResponsesWatch(
  formId: string,
  watchId: string,
  accessToken: string,
): Promise<WatchResult> {
  const res = await formsFetch(
    `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches/${encodeURIComponent(watchId)}:renew`,
    accessToken,
    { method: "POST" },
  );
  return (await res.json()) as WatchResult;
}
