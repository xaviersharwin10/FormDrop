import type { FormSubmissionPayload } from "@formdrop/shared";
import { config } from "./config.js";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** Exchanges the long-lived refresh token for a short-lived access token — no caching, since claim emails are infrequent enough that a fresh exchange per send is negligible cost. */
async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleOAuthClientId,
      client_secret: config.googleOAuthClientSecret,
      refresh_token: config.googleOAuthRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail OAuth token refresh failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Fires right after an APPROVE verdict. Failure here must never fail the
 * webhook response — the payment already settled and the verdict is
 * already recorded; a bounced or undeliverable email just means the
 * respondent needs the claim link resent some other way, not that the
 * whole submission should error out.
 */
export async function sendClaimEmail(payload: FormSubmissionPayload): Promise<void> {
  const claimUrl = `${config.webAppUrl}/claim?formId=${encodeURIComponent(payload.formId)}&responseId=${encodeURIComponent(payload.responseId)}`;

  try {
    const accessToken = await getAccessToken();

    const mimeMessage = [
      `To: ${payload.respondentEmail}`,
      `From: FormDrop <${config.gmailSenderEmail}>`,
      `Subject: You've been paid for your response - claim it now`,
      `Content-Type: text/html; charset=utf-8`,
      "",
      `<p>Your form response was approved.</p><p><a href="${claimUrl}">Click here to verify you're a real, unique person and claim your payout</a>.</p><p>Takes about 30 seconds — a quick face scan, then the money is yours.</p>`,
    ].join("\r\n");

    const response = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ raw: toBase64Url(mimeMessage) }),
    });

    if (!response.ok) {
      throw new Error(`Gmail send failed: HTTP ${response.status} ${await response.text()}`);
    }
  } catch (err) {
    console.error("sendClaimEmail failed:", err);
  }
}
