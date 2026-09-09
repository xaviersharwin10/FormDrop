import { signRequest } from "@worldcoin/idkit-server";
import { config } from "./config.js";

const VERIFY_BASE = "https://developer.world.org/api/v4/verify";

export interface RpSignatureBundle {
  app_id: string;
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
  environment: "production" | "staging" | "sandbox";
}

/**
 * Signs an RP request server-side (never in the browser — the signing key
 * proves this request really came from us, preventing impersonation).
 * `action` scopes the resulting nullifier: we use one per form
 * (`formdrop-claim-<formId>`) so a verified human can claim once per pot,
 * without being locked out of every other form forever.
 */
export function getRpSignature(action: string): RpSignatureBundle {
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: config.worldSigningKey,
    action,
  });

  return {
    app_id: config.worldAppId,
    rp_id: config.worldRpId,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
    signature: sig,
    environment: config.worldEnvironment,
  };
}

interface IdKitResponseItem {
  identifier: string;
  nullifier: string;
  [key: string]: unknown;
}

export interface IdKitVerifyPayload {
  protocol_version: string;
  nonce: string;
  responses: IdKitResponseItem[];
  [key: string]: unknown;
}

/**
 * Forwards the client's IDKit proof to World's verification endpoint as-is
 * (no field remapping) and returns whether it's cryptographically valid.
 * Does NOT check nullifier reuse — that's a separate, local decision, since
 * World has no concept of "already claimed this form's pot."
 */
export async function verifyWorldIdProof(
  idkitResponse: IdKitVerifyPayload,
): Promise<{ valid: boolean; nullifiers: string[] }> {
  const res = await fetch(`${VERIFY_BASE}/${config.worldRpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(idkitResponse),
  });

  return {
    valid: res.ok,
    nullifiers: idkitResponse.responses.map((r) => r.nullifier),
  };
}
