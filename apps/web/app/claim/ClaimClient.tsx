"use client";

import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  type ClaimResult,
  type ResponseStatus,
  type RpSignatureBundle,
  getResponseStatus,
  getWorldRpSignature,
  submitClaim,
} from "@/lib/orchestrator";

export function ClaimClient() {
  const params = useSearchParams();
  const formId = params.get("formId") ?? "";
  const responseId = params.get("responseId") ?? "";

  const [status, setStatus] = useState<ResponseStatus | null>(null);
  const [rpBundle, setRpBundle] = useState<RpSignatureBundle | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!formId || !responseId) return;
    getResponseStatus(formId, responseId)
      .then(setStatus)
      .catch((err) => setError((err as Error).message));
  }, [formId, responseId]);

  const startClaim = useCallback(async () => {
    setError(null);
    try {
      const bundle = await getWorldRpSignature(formId);
      setRpBundle(bundle);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [formId]);

  if (!formId || !responseId) {
    return (
      <main>
        <h1>FormDrop</h1>
        <div className="card">
          <p>This link is missing its form/response reference.</p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <h1>You&rsquo;ve been paid</h1>
      <p className="hint">One quick check to prove you&rsquo;re a real, unique person, then the money is yours.</p>

      {result ? (
        <div className="card">
          <span className="badge funded">Paid</span>
          <p className="mono" style={{ marginTop: 12 }}>
            wallet: {result.walletAddress}
          </p>
          <p className="mono">tx: {result.payoutTransactionId}</p>
        </div>
      ) : status?.claimed ? (
        <div className="card">
          <p>This payout has already been claimed.</p>
        </div>
      ) : status && status.decision !== "APPROVE" ? (
        <div className="card">
          <p>This response wasn&rsquo;t approved for payout.</p>
        </div>
      ) : (
        <div className="card">
          <p>Click below, then complete a quick Selfie Check on your phone — no seed phrase, no wallet setup.</p>
          <button onClick={startClaim} disabled={!status}>
            Claim my payout
          </button>
          {error && <p className="error">{error}</p>}

          {rpBundle && (
            <IDKitRequestWidget
              open={open}
              onOpenChange={setOpen}
              app_id={rpBundle.app_id}
              action={rpBundle.action}
              environment={rpBundle.environment}
              allow_legacy_proofs={true}
              rp_context={{
                rp_id: rpBundle.rp_id,
                nonce: rpBundle.nonce,
                created_at: rpBundle.created_at,
                expires_at: rpBundle.expires_at,
                signature: rpBundle.signature,
              }}
              preset={selfieCheckLegacy({ signal: responseId })}
              handleVerify={async (idkitResult) => {
                const claimResult = await submitClaim(formId, responseId, idkitResult);
                setResult(claimResult);
              }}
              onSuccess={() => {}}
              onError={(code) => setError(String(code))}
            />
          )}
        </div>
      )}
    </main>
  );
}
