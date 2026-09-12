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
  tinybarToHbar,
} from "@/lib/orchestrator";
import { hashscanAccountUrl, hashscanTransactionUrl } from "@/lib/hashscan";
import { HashChip } from "@/components/HashChip";
import { Wordmark } from "@/components/Logo";
import { CheckIcon, CrossIcon, WarningIcon } from "@/components/Icons";

export function ClaimClient() {
  const params = useSearchParams();
  const formId = params.get("formId") ?? "";
  const responseId = params.get("responseId") ?? "";

  const [status, setStatus] = useState<ResponseStatus | null>(null);
  const [rpBundle, setRpBundle] = useState<RpSignatureBundle | null>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!formId || !responseId) return;
    getResponseStatus(formId, responseId)
      .then(setStatus)
      .catch((err) => setError((err as Error).message));
  }, [formId, responseId]);

  const startClaim = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const bundle = await getWorldRpSignature(formId);
      setRpBundle(bundle);
      setOpen(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }, [formId]);

  if (!formId || !responseId) {
    return (
      <div className="claim-shell">
        <div className="claim-card card fade-in-up">
          <div className="claim-brand">
            <Wordmark />
          </div>
          <div className="status-icon">
            <WarningIcon size={26} />
          </div>
          <p className="claim-subtext" style={{ marginBottom: 0 }}>
            This link is missing its form or response reference. Ask the form creator for the exact link
            from their claim email.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="claim-shell">
      <div className="claim-card fade-in-up">
        <div className="claim-brand">
          <Wordmark />
        </div>

        {result ? (
          <div className="card">
            <div className="success-icon success-icon-pop">
              <CheckIcon size={28} />
            </div>
            <h1 className="claim-headline">You&rsquo;ve been paid</h1>
            <p className="claim-subtext">The payout settled on Hedera testnet — here&rsquo;s the proof.</p>
            <div className="result-row">
              <span className="result-label">Wallet</span>
              <HashChip value={result.walletAddress} href={hashscanAccountUrl(result.walletAddress)} />
            </div>
            <div className="result-row">
              <span className="result-label">Transaction</span>
              <HashChip value={result.payoutTransactionId} href={hashscanTransactionUrl(result.payoutTransactionId)} />
            </div>
            <p className="footer-note">No account needed on your end — the transfer is public and verifiable.</p>
          </div>
        ) : status?.claimed ? (
          <div className="card">
            <div className="status-icon">
              <CheckIcon size={24} />
            </div>
            <h1 className="claim-headline">Already claimed</h1>
            <p className="claim-subtext" style={{ marginBottom: 0 }}>
              This payout was already sent. Each approved response can only be claimed once.
            </p>
          </div>
        ) : status && status.decision !== "APPROVE" ? (
          <div className="card">
            <div className="status-icon">
              <CrossIcon size={24} />
            </div>
            <h1 className="claim-headline">Not approved this time</h1>
            <p className="claim-subtext" style={{ marginBottom: 0 }}>
              This response wasn&rsquo;t approved for payout by the review agent.
            </p>
          </div>
        ) : (
          <div className="card">
            {status?.pricePerResponseTinybar && (
              <div className="reward-banner">
                <div className="reward-label">Your payout</div>
                <div className="reward-value">{tinybarToHbar(status.pricePerResponseTinybar)} HBAR</div>
              </div>
            )}
            <h1 className="claim-headline">One quick check, then it&rsquo;s yours</h1>
            <p className="claim-subtext">
              A 10-second Selfie Check proves you&rsquo;re a real, unique person — no seed phrase, no wallet
              setup, no crypto knowledge needed.
            </p>

            <div className="reassurance-list">
              <div className="reassurance-item">
                <span className="check-icon">
                  <CheckIcon size={10} />
                </span>
                Your wallet is created automatically the first time you claim
              </div>
              <div className="reassurance-item">
                <span className="check-icon">
                  <CheckIcon size={10} />
                </span>
                World ID only proves you&rsquo;re a unique human — it doesn&rsquo;t share your identity
              </div>
              <div className="reassurance-item">
                <span className="check-icon">
                  <CheckIcon size={10} />
                </span>
                Funds arrive within seconds of a successful check
              </div>
            </div>

            <button className="full" onClick={startClaim} disabled={!status || starting}>
              {starting && <span className="spinner" />}
              {starting ? "Preparing…" : "Claim my payout"}
            </button>
            {error && (
              <p className="error">
                <WarningIcon size={13} />
                {error}
              </p>
            )}

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
                  try {
                    const claimResult = await submitClaim(formId, responseId, idkitResult);
                    setResult(claimResult);
                  } catch (err) {
                    // Our own backend's rejection reason (e.g. "this person
                    // has already claimed a payout from this form") is the
                    // real, useful message here — surface it directly
                    // instead of letting IDKit collapse it into its generic
                    // "failed_by_host_app" code below.
                    setError((err as Error).message);
                    throw err;
                  }
                }}
                onSuccess={() => {}}
                onError={(code) => {
                  // "failed_by_host_app" means handleVerify's own catch
                  // above already set a specific, real message — don't
                  // clobber it with the generic code.
                  if (String(code) !== "failed_by_host_app") setError(String(code));
                }}
              />
            )}
          </div>
        )}

        <p className="footer-note">Secured by World ID · Settled on Hedera</p>
      </div>
    </div>
  );
}
