import { OAuth2Client } from "google-auth-library";
import type { FormSubmissionPayload } from "@formdrop/shared";
import { config } from "./config.js";
import { getFormWatch, getGoogleAccount, updateWatchAfterFetch } from "./db/googleForms.js";
import { getAccessTokenFromRefreshToken } from "./googleFormsAuth.js";
import { getQuestionTitles, listNewResponses } from "./googleFormsApi.js";
import { getResponse } from "./db/responses.js";
import { handleFormSubmit } from "./webhook.js";

const oauthClient = new OAuth2Client();

/**
 * Confirms this push actually came from our own Pub/Sub subscription, not a
 * forged POST to a public endpoint — verifies the signed OIDC token Google
 * attaches when the subscription has "Enable authentication" turned on, and
 * checks both the audience and the specific service account email match
 * what we configured when creating the subscription.
 */
export async function verifyPubSubPushToken(authorizationHeader: string | undefined): Promise<void> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token on push request");
  }
  const idToken = authorizationHeader.slice("Bearer ".length);
  const ticket = await oauthClient.verifyIdToken({ idToken, audience: config.googlePubsubPushAudience });
  const payload = ticket.getPayload();
  if (payload?.email !== config.googlePubsubPushServiceAccountEmail) {
    throw new Error(`Unexpected push token principal: ${payload?.email}`);
  }
}

interface PubSubPushBody {
  message?: {
    attributes?: Record<string, string>;
  };
}

/**
 * Notifications carry no response data (just formId/eventType/watchId) — this
 * fetches what's actually new since the last check and feeds each one
 * through the exact same handleFormSubmit pipeline the Apps Script webhook
 * uses, so payment/verdict/payout/claim-email logic isn't duplicated.
 */
export async function handleFormsPushNotification(body: PubSubPushBody): Promise<void> {
  const attributes = body.message?.attributes;
  const formId = attributes?.formId;
  if (!formId || attributes?.eventType !== "RESPONSES") return;

  const watch = await getFormWatch(formId);
  if (!watch) return; // not a form registered through this path (or already unregistered)

  const account = await getGoogleAccount(watch.creatorId);
  if (!account) return;

  const accessToken = await getAccessTokenFromRefreshToken(account.refreshToken);
  const [questionTitles, newResponses] = await Promise.all([
    getQuestionTitles(formId, accessToken),
    listNewResponses(formId, accessToken, watch.lastFetchedIso),
  ]);

  let allSucceeded = true;
  let latestSeenIso = watch.lastFetchedIso;

  for (const raw of newResponses) {
    if (raw.createTime > latestSeenIso) latestSeenIso = raw.createTime;

    // Idempotency: a redelivered Pub/Sub message, or a window that overlaps
    // a previous fetch, must never re-run payment/email for the same response.
    if (await getResponse(formId, raw.responseId)) continue;

    if (!raw.respondentEmail) {
      console.error(`Skipping ${formId}/${raw.responseId}: no respondentEmail (enable "Collect email addresses")`);
      continue;
    }

    const answers: Record<string, string> = {};
    for (const [questionId, answer] of Object.entries(raw.answers ?? {})) {
      const title = questionTitles.get(questionId) ?? questionId;
      answers[title] = answer.textAnswers?.answers?.map((a) => a.value ?? "").join(", ") ?? "";
    }

    const payload: FormSubmissionPayload = {
      formId,
      responseId: raw.responseId,
      respondentEmail: raw.respondentEmail,
      submittedAtIso: raw.createTime,
      answers,
    };

    try {
      await handleFormSubmit(payload);
    } catch (err) {
      allSucceeded = false;
      console.error(`push-triggered handleFormSubmit failed for ${formId}/${raw.responseId}:`, err);
    }
  }

  // Only advance the watermark past this whole batch if every response in it
  // was actually handled — a failure leaves last_fetched_iso where it was,
  // so the next notification refetches (and safely re-skips, via the
  // getResponse check above, whatever already succeeded) instead of a
  // payment failure silently never being retried.
  if (allSucceeded) {
    await updateWatchAfterFetch(formId, latestSeenIso);
  }
}
