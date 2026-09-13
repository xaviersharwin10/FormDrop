import { getFormConfig } from "./db/forms.js";
import { getResponse, markClaimed, recordClaimError } from "./db/responses.js";
import { isNullifierUsed, markNullifierUsed } from "./db/nullifiers.js";
import { verifyWorldIdProof, type IdKitVerifyPayload } from "./world.js";
import { getOrCreateRespondentWallet } from "./privy.js";
import { payoutFromEscrow } from "./hederaEscrow.js";

export function claimAction(formId: string): string {
  return `formdrop-claim-${formId}`;
}

export class ClaimError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The whole point of Loop 2: an APPROVE verdict alone never pays anyone.
 * Only a form response that's (a) approved by the agent, (b) not already
 * claimed, and (c) backed by a fresh, valid World ID Selfie Check proof —
 * whose nullifier hasn't funded a claim on THIS form before — triggers a
 * real payout. Remove step (c) and the product is just "pay whoever
 * submits a form," which is exactly the fraud vector this exists to close.
 */
export async function processClaim(
  formId: string,
  responseId: string,
  idkitResponse: IdKitVerifyPayload,
): Promise<{ payoutTransactionId: string; walletAddress: string }> {
  const formConfig = await getFormConfig(formId);
  if (!formConfig) {
    throw new ClaimError(404, "form not configured");
  }

  const response = await getResponse(formId, responseId);
  if (!response) {
    throw new ClaimError(404, "response not found");
  }

  // From here on, `response` exists — so every rejection is recorded
  // against it, not just returned to the caller. Otherwise a rejected
  // claim leaves no trace anywhere in our own data, and the creator
  // dashboard has nothing to show for why a response never got paid out.
  const reject = async (status: number, message: string): Promise<never> => {
    await recordClaimError(formId, responseId, message);
    throw new ClaimError(status, message);
  };

  if (response.verdict.decision !== "APPROVE") {
    return reject(403, "this response was not approved for payout");
  }
  if (response.claimed) {
    return reject(409, "already claimed");
  }

  const { valid, nullifiers } = await verifyWorldIdProof(idkitResponse);
  if (!valid) {
    return reject(422, "World ID proof failed verification");
  }

  const action = claimAction(formId);
  for (const n of nullifiers) {
    if (await isNullifierUsed(n, action)) {
      return reject(409, "this person has already claimed a payout from this form");
    }
  }

  const wallet = await getOrCreateRespondentWallet(response.payload.respondentEmail);
  const payoutTransactionId = await payoutFromEscrow(
    formId,
    responseId,
    wallet.address,
    formConfig.pricePerResponseTinybar,
  );

  for (const nullifier of nullifiers) {
    await markNullifierUsed(nullifier, action);
  }
  await markClaimed(formId, responseId, payoutTransactionId);

  return { payoutTransactionId, walletAddress: wallet.address };
}
