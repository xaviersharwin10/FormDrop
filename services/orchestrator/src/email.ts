import type { FormSubmissionPayload } from "@formdrop/shared";
import { config } from "./config.js";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";

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
    const response = await fetch(BREVO_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": config.brevoApiKey,
      },
      body: JSON.stringify({
        sender: { name: "FormDrop", email: config.brevoSenderEmail },
        to: [{ email: payload.respondentEmail }],
        subject: "You've been paid for your response — claim it now",
        htmlContent: `<p>Your form response was approved.</p><p><a href="${claimUrl}">Click here to verify you're a real, unique person and claim your payout</a>.</p><p>Takes about 30 seconds — a quick face scan, then the money is yours.</p>`,
        textContent: `Your form response was approved. Claim your payout here: ${claimUrl}\n\nTakes about 30 seconds — a quick face scan, then the money is yours.`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Brevo send failed: HTTP ${response.status} ${await response.text()}`);
    }
  } catch (err) {
    console.error("sendClaimEmail failed:", err);
  }
}
