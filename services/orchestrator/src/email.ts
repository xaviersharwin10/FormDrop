import nodemailer from "nodemailer";
import type { FormSubmissionPayload } from "@formdrop/shared";
import { config } from "./config.js";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: config.gmailUser,
    pass: config.gmailAppPassword,
  },
});

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
    await transporter.sendMail({
      from: `FormDrop <${config.gmailUser}>`,
      to: payload.respondentEmail,
      subject: "You've been paid for your response — claim it now",
      html: `<p>Your form response was approved.</p><p><a href="${claimUrl}">Click here to verify you're a real, unique person and claim your payout</a>.</p><p>Takes about 30 seconds — a quick face scan, then the money is yours.</p>`,
      text: `Your form response was approved. Claim your payout here: ${claimUrl}\n\nTakes about 30 seconds — a quick face scan, then the money is yours.`,
    });
  } catch (err) {
    console.error("sendClaimEmail failed:", err);
  }
}
