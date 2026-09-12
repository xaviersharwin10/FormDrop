import Fastify from "fastify";
import cors from "@fastify/cors";
import type Stripe from "stripe";
import { parseFormSubmissionPayload } from "./validate.js";
import { handleFormSubmit } from "./webhook.js";
import { getFormConfig, getFormsForCreator, markFunded, setFormConfig, type FormConfig } from "./db/forms.js";
import { getResponse, getResponsesForForm } from "./db/responses.js";
import {
  verifyIncomingHbarTransfer,
  verifyIncomingTokenTransfer,
  getAccountHbarBalanceTinybar,
  HEDERA_TESTNET_USDC_TOKEN_ID,
  USDC_BASE_UNITS_PER_USD_CENT,
} from "./hederaMirror.js";
import { createFundingCheckoutSession, constructWebhookEvent, tinybarToUsdCents } from "./stripeFunding.js";
import { getOrCreateCreatorWallet } from "./privyCreatorWallet.js";
import { fundPotFromCreatorWallet } from "./hederaPrivyFunding.js";
import { config } from "./config.js";
import { claimAction, ClaimError, processClaim } from "./claim.js";
import { getRpSignature } from "./world.js";
import type { IdKitVerifyPayload } from "./world.js";
import { exchangeCodeForTokens, getAccessTokenFromRefreshToken, getGoogleEmail, googleFormsAuthUrl } from "./googleFormsAuth.js";
import { createResponsesWatch, getQuestionTitles, renewResponsesWatch } from "./googleFormsApi.js";
import {
  getAllFormWatches,
  getFormWatch,
  getGoogleAccount,
  upsertFormWatch,
  upsertGoogleAccount,
} from "./db/googleForms.js";
import { handleFormsPushNotification, verifyPubSubPushToken } from "./googleFormsPush.js";

/**
 * The full stats shape the web app's `FormStats` type expects — computed
 * fields like potTinybar/remainingBudgetTinybar aren't part of FormConfig
 * itself. Every endpoint that returns "the form's current state" to the
 * browser (not just internal bookkeeping) must go through this, not send a
 * raw FormConfig — the web app renders potTinybar unconditionally as soon
 * as it gets a response back.
 */
async function buildStats(formConfig: FormConfig) {
  const responses = await getResponsesForForm(formConfig.formId);
  const approved = responses.filter((r) => r.verdict.decision === "APPROVE").length;
  const rejected = responses.filter((r) => r.verdict.decision === "REJECT").length;
  const spentTinybar = BigInt(formConfig.pricePerResponseTinybar) * BigInt(approved);
  const potTinybar = BigInt(formConfig.pricePerResponseTinybar) * BigInt(formConfig.maxResponses);

  return {
    formId: formConfig.formId,
    pricePerResponseTinybar: formConfig.pricePerResponseTinybar,
    maxResponses: formConfig.maxResponses,
    funded: formConfig.funded,
    fundingTransactionId: formConfig.fundingTransactionId,
    received: responses.length,
    approved,
    rejected,
    remainingResponses: Math.max(0, formConfig.maxResponses - approved),
    potTinybar: potTinybar.toString(),
    remainingBudgetTinybar: (potTinybar - spentTinybar).toString(),
  };
}

export function buildServer() {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  // Overrides Fastify's default JSON parser to also stash the raw request
  // bytes — Stripe's webhook signature check needs the exact raw body,
  // which is no longer available once something has JSON.parse'd it.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    request.rawBody = body as Buffer;
    if (body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/webhook/form-submit", async (request, reply) => {
    let payload;
    try {
      payload = parseFormSubmissionPayload(request.body);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }

    try {
      const result = await handleFormSubmit(payload);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, "handleFormSubmit failed");
      return reply.status(502).send({ error: "verification call failed" });
    }
  });

  app.post("/forms", async (request, reply) => {
    const body = request.body as Partial<{
      formId: string;
      pricePerResponseTinybar: string;
      maxResponses: number;
      creatorId: string;
    }>;

    if (
      typeof body.formId !== "string" ||
      body.formId === "" ||
      typeof body.pricePerResponseTinybar !== "string" ||
      typeof body.maxResponses !== "number" ||
      body.maxResponses <= 0
    ) {
      return reply.status(400).send({ error: "formId, pricePerResponseTinybar, maxResponses are required" });
    }

    const formConfig = await setFormConfig({
      formId: body.formId,
      pricePerResponseTinybar: body.pricePerResponseTinybar,
      maxResponses: body.maxResponses,
      createdAtIso: new Date().toISOString(),
      creatorId: typeof body.creatorId === "string" && body.creatorId !== "" ? body.creatorId : null,
    });
    return reply.send(await buildStats(formConfig));
  });

  // ---------- Google Forms push-notification onboarding (no Apps Script) ----------
  // Lets any creator connect their own Google account and register a form
  // for real-time response notifications via the Forms API + Pub/Sub,
  // instead of installing/registering our Apps Script project. See
  // specs/DECISIONS.md for why this exists alongside, not instead of, the
  // Apps Script path.

  app.get("/auth/google/start", async (request, reply) => {
    const { creatorId } = request.query as { creatorId?: string };
    if (!creatorId) return reply.status(400).send({ error: "creatorId is required" });
    return reply.redirect(googleFormsAuthUrl(creatorId));
  });

  app.get("/auth/google/callback", async (request, reply) => {
    const { code, state, error } = request.query as { code?: string; state?: string; error?: string };
    if (error || !code || !state) {
      return reply.redirect(`${config.webAppUrl}/?googleConnectError=${encodeURIComponent(error ?? "missing_code")}`);
    }
    try {
      const tokens = await exchangeCodeForTokens(code);
      if (!tokens.refresh_token) {
        // Already connected before and Google didn't re-issue one — the
        // stored one is still valid, so this isn't actually an error case,
        // but there's nothing new to save either.
        return reply.redirect(`${config.webAppUrl}/?googleConnected=1`);
      }
      const googleEmail = await getGoogleEmail(tokens.access_token);
      await upsertGoogleAccount({ creatorId: state, googleEmail, refreshToken: tokens.refresh_token });
      return reply.redirect(`${config.webAppUrl}/?googleConnected=1`);
    } catch (err) {
      request.log.error(err, "Google Forms OAuth callback failed");
      return reply.redirect(`${config.webAppUrl}/?googleConnectError=exchange_failed`);
    }
  });

  app.get("/creators/:creatorId/google-account", async (request, reply) => {
    const { creatorId } = request.params as { creatorId: string };
    const account = await getGoogleAccount(creatorId);
    return reply.send({ connected: !!account, googleEmail: account?.googleEmail ?? null });
  });

  app.post("/forms/:formId/watch", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const { creatorId } = request.body as { creatorId?: string };
    if (!creatorId) return reply.status(400).send({ error: "creatorId is required" });

    const account = await getGoogleAccount(creatorId);
    if (!account) {
      return reply.status(400).send({ error: "Connect a Google account first (GET /auth/google/start)" });
    }

    try {
      const accessToken = await getAccessTokenFromRefreshToken(account.refreshToken);
      // Confirms this Google account can actually read the form before
      // registering a watch against it — a clearer error than a mismatched
      // permission failure showing up later, inside a webhook Pub/Sub retries.
      await getQuestionTitles(formId, accessToken);
      const watch = await createResponsesWatch(formId, accessToken);
      const registered = await upsertFormWatch({
        formId,
        creatorId,
        watchId: watch.id,
        expireTimeIso: watch.expireTime,
        lastFetchedIso: new Date().toISOString(),
      });
      return reply.send(registered);
    } catch (err) {
      request.log.error(err, "createResponsesWatch failed");
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.get("/forms/:formId/watch", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const watch = await getFormWatch(formId);
    return reply.send({ watching: !!watch, expireTimeIso: watch?.expireTimeIso ?? null });
  });

  app.post("/webhooks/forms-push", async (request, reply) => {
    try {
      await verifyPubSubPushToken(request.headers.authorization);
    } catch (err) {
      request.log.error(err, "Pub/Sub push token verification failed");
      return reply.status(401).send({ error: "invalid push token" });
    }

    try {
      await handleFormsPushNotification(request.body as Parameters<typeof handleFormsPushNotification>[0]);
    } catch (err) {
      request.log.error(err, "handleFormsPushNotification failed");
      // A 5xx tells Pub/Sub to retry the delivery — appropriate for a
      // transient failure (e.g. our DB briefly unreachable), and safe to
      // retry given handleFormsPushNotification's own idempotency.
      return reply.status(500).send({ error: "processing failed" });
    }
    return reply.status(204).send();
  });

  // Renews every watch expiring within 2 days — watches.renew resets the
  // 7-day clock. No auth: worst case an outsider triggers extra renewals of
  // already-legitimate watches, which costs nothing and leaks nothing.
  // Intended to be hit by a scheduled ping (same pattern as the existing
  // keepalive cron jobs), at least once a day.
  app.post("/internal/renew-watches", async (request, reply) => {
    const watches = await getAllFormWatches();
    const twoDaysFromNow = Date.now() + 2 * 24 * 60 * 60 * 1000;
    let renewed = 0;
    for (const watch of watches) {
      if (new Date(watch.expireTimeIso).getTime() > twoDaysFromNow) continue;
      try {
        const account = await getGoogleAccount(watch.creatorId);
        if (!account) continue;
        const accessToken = await getAccessTokenFromRefreshToken(account.refreshToken);
        const renewedWatch = await renewResponsesWatch(watch.formId, watch.watchId, accessToken);
        await upsertFormWatch({
          formId: watch.formId,
          creatorId: watch.creatorId,
          watchId: renewedWatch.id,
          expireTimeIso: renewedWatch.expireTime,
          lastFetchedIso: watch.lastFetchedIso,
        });
        renewed++;
      } catch (err) {
        request.log.error(err, `Failed to renew watch for form ${watch.formId}`);
      }
    }
    return reply.send({ checked: watches.length, renewed });
  });

  app.get("/creators/:creatorId/forms", async (request, reply) => {
    const { creatorId } = request.params as { creatorId: string };
    const forms = await getFormsForCreator(creatorId);
    return reply.send(await Promise.all(forms.map(buildStats)));
  });

  app.get("/forms/:formId/treasury", async () => ({
    treasuryAccountId: config.hederaAccountId,
    usdcTokenId: HEDERA_TESTNET_USDC_TOKEN_ID,
    usdCentsPerHbar: config.usdCentsPerHbar,
  }));

  app.post("/forms/:formId/verify-funding", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const { transactionId, asset } = request.body as Partial<{ transactionId: string; asset: "HBAR" | "USDC" }>;
    const formConfig = await getFormConfig(formId);

    if (!formConfig) {
      return reply.status(404).send({ error: "form not configured yet" });
    }
    if (typeof transactionId !== "string" || transactionId === "") {
      return reply.status(400).send({ error: "transactionId is required" });
    }

    const potTinybar = BigInt(formConfig.pricePerResponseTinybar) * BigInt(formConfig.maxResponses);

    let verified: boolean;
    if (asset === "USDC") {
      const minUsdcBaseUnits = BigInt(tinybarToUsdCents(potTinybar.toString())) * USDC_BASE_UNITS_PER_USD_CENT;
      verified = await verifyIncomingTokenTransfer(
        transactionId,
        config.hederaAccountId,
        HEDERA_TESTNET_USDC_TOKEN_ID,
        minUsdcBaseUnits,
      );
      if (!verified) {
        return reply.status(422).send({
          error: `Mirror Node doesn't show a testnet USDC transfer of at least ${minUsdcBaseUnits} base units to ${config.hederaAccountId} for that transaction id`,
        });
      }
    } else {
      verified = await verifyIncomingHbarTransfer(transactionId, config.hederaAccountId, potTinybar);
      if (!verified) {
        return reply.status(422).send({
          error: `Mirror Node doesn't show a transfer of at least ${potTinybar} tinybars to ${config.hederaAccountId} for that transaction id`,
        });
      }
    }

    const updated = await markFunded(formId, transactionId);
    return reply.send(await buildStats(updated!));
  });

  app.post("/forms/:formId/fund/checkout-session", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const formConfig = await getFormConfig(formId);
    if (!formConfig) {
      return reply.status(404).send({ error: "form not configured yet" });
    }
    if (formConfig.funded) {
      return reply.status(409).send({ error: "form is already funded" });
    }

    const { successUrl, cancelUrl } = request.body as Partial<{ successUrl: string; cancelUrl: string }>;
    if (typeof successUrl !== "string" || typeof cancelUrl !== "string") {
      return reply.status(400).send({ error: "successUrl and cancelUrl are required" });
    }

    const potTinybar = (BigInt(formConfig.pricePerResponseTinybar) * BigInt(formConfig.maxResponses)).toString();

    try {
      const url = await createFundingCheckoutSession(formId, potTinybar, successUrl, cancelUrl);
      return reply.send({ url });
    } catch (err) {
      request.log.error(err, "createFundingCheckoutSession failed");
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.get("/forms/:formId/privy-wallet", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    try {
      const wallet = await getOrCreateCreatorWallet(formId);
      const balanceTinybar = await getAccountHbarBalanceTinybar(wallet.address);
      return reply.send({ address: wallet.address, balanceTinybar });
    } catch (err) {
      request.log.error(err, "getOrCreateCreatorWallet failed");
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.post("/forms/:formId/fund/privy-transfer", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const formConfig = await getFormConfig(formId);
    if (!formConfig) {
      return reply.status(404).send({ error: "form not configured yet" });
    }
    if (formConfig.funded) {
      return reply.status(409).send({ error: "form is already funded" });
    }

    const potTinybar = (BigInt(formConfig.pricePerResponseTinybar) * BigInt(formConfig.maxResponses)).toString();

    try {
      const { transactionId } = await fundPotFromCreatorWallet(formId, potTinybar);
      const updated = await markFunded(formId, transactionId);
      return reply.send(await buildStats(updated!));
    } catch (err) {
      request.log.error(err, "fundPotFromCreatorWallet failed");
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.post("/webhooks/stripe", async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    if (typeof signature !== "string" || !request.rawBody) {
      return reply.status(400).send({ error: "missing stripe-signature header or raw body" });
    }

    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(request.rawBody, signature);
    } catch (err) {
      request.log.error(err, "Stripe webhook signature verification failed");
      return reply.status(400).send({ error: "invalid signature" });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const formId = session.metadata?.formId;
      if (formId && session.payment_status === "paid") {
        await markFunded(formId, `stripe:${session.id}`);
      }
    }

    return reply.send({ received: true });
  });

  app.get("/forms/:formId/stats", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const formConfig = await getFormConfig(formId);
    if (!formConfig) {
      return reply.status(404).send({ error: "form not configured yet" });
    }

    return reply.send(await buildStats(formConfig));
  });

  app.get("/forms/:formId/responses", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const responses = await getResponsesForForm(formId);

    return reply.send(
      responses.map((r) => ({
        responseId: r.payload.responseId,
        respondentEmail: r.payload.respondentEmail,
        submittedAtIso: r.payload.submittedAtIso,
        decision: r.verdict.decision,
        confidence: r.verdict.confidence,
        reasoning: r.verdict.reasoning,
        x402TransactionId: r.x402TransactionId,
        claimed: r.claimed,
        payoutTransactionId: r.payoutTransactionId,
        hcsTransactionId: r.hcsTransactionId,
        hcsSequenceNumber: r.hcsSequenceNumber,
        lastClaimError: r.lastClaimError,
        lastClaimAttemptIso: r.lastClaimAttemptIso,
      })),
    );
  });

  app.get("/forms/:formId/responses/:responseId", async (request, reply) => {
    const { formId, responseId } = request.params as { formId: string; responseId: string };
    const response = await getResponse(formId, responseId);
    if (!response) {
      return reply.status(404).send({ error: "response not found" });
    }
    const formConfig = await getFormConfig(formId);
    return reply.send({
      formId,
      responseId,
      decision: response.verdict.decision,
      reasoning: response.verdict.reasoning,
      claimed: response.claimed,
      x402TransactionId: response.x402TransactionId,
      hcsTransactionId: response.hcsTransactionId,
      hcsSequenceNumber: response.hcsSequenceNumber,
      pricePerResponseTinybar: formConfig?.pricePerResponseTinybar ?? null,
    });
  });

  app.post("/forms/:formId/world-rp-signature", async (request) => {
    const { formId } = request.params as { formId: string };
    const action = claimAction(formId);
    return { ...getRpSignature(action), action };
  });

  app.post("/forms/:formId/responses/:responseId/claim", async (request, reply) => {
    const { formId, responseId } = request.params as { formId: string; responseId: string };
    const idkitResponse = request.body as IdKitVerifyPayload;

    try {
      const result = await processClaim(formId, responseId, idkitResponse);
      return reply.send({ success: true, ...result });
    } catch (err) {
      if (err instanceof ClaimError) {
        return reply.status(err.status).send({ error: err.message });
      }
      request.log.error(err, "processClaim failed");
      return reply.status(500).send({ error: "claim failed" });
    }
  });

  return app;
}
