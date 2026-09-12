"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import {
  createFundingCheckoutSession,
  type FormResponseSummary,
  type FormStats,
  type FundingAsset,
  fundPotFromPrivyWallet,
  getCreatorPrivyWallet,
  getResponses,
  getStats,
  getTreasuryAccountId,
  hbarToTinybar,
  saveFormConfig,
  tinybarToHbar,
  verifyFunding,
} from "@/lib/orchestrator";
import { hashscanTransactionUrl } from "@/lib/hashscan";
import { HashChip } from "@/components/HashChip";
import { Wordmark } from "@/components/Logo";

function initials(input: string): string {
  const at = input.indexOf("@");
  const namePart = at > 0 ? input.slice(0, at) : input;
  return namePart.slice(0, 2).toUpperCase();
}

export default function CreatorConsole() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const [formId, setFormId] = useState("demo-form-1");
  const [priceHbar, setPriceHbar] = useState("1");
  const [maxResponses, setMaxResponses] = useState(300);
  const [stats, setStats] = useState<FormStats | null>(null);
  const [responses, setResponses] = useState<FormResponseSummary[]>([]);
  const [treasury, setTreasury] = useState<{
    treasuryAccountId: string;
    usdcTokenId: string;
    usdCentsPerHbar: number;
  } | null>(null);
  const [fundingTxId, setFundingTxId] = useState("");
  const [fundingMethod, setFundingMethod] = useState<"card" | "crypto" | "privy">("card");
  const [cryptoAsset, setCryptoAsset] = useState<FundingAsset>("HBAR");
  const [privyWalletAddress, setPrivyWalletAddress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [fundingWithPrivy, setFundingWithPrivy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStats = useCallback(async (id: string) => {
    try {
      setStats(await getStats(id));
      setResponses(await getResponses(id));
    } catch {
      // form not configured yet on the orchestrator — fine, ignore until saved
    }
  }, []);

  useEffect(() => {
    if (!stats) return;
    const interval = setInterval(() => refreshStats(stats.formId), 4000);
    return () => clearInterval(interval);
  }, [stats, refreshStats]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await saveFormConfig({
        formId,
        pricePerResponseTinybar: hbarToTinybar(priceHbar),
        maxResponses,
      });
      // saveFormConfig's response is just the raw form config (no
      // potTinybar/received/approved/etc — those are computed only by
      // /stats), so fetch the full stats shape instead of using it directly.
      setStats(await getStats(formId));
      setTreasury(await getTreasuryAccountId(formId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [formId, priceHbar, maxResponses]);

  const handleVerifyFunding = useCallback(async () => {
    setVerifying(true);
    setError(null);
    try {
      const result = await verifyFunding(formId, fundingTxId.trim(), cryptoAsset);
      setStats(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setVerifying(false);
    }
  }, [formId, fundingTxId, cryptoAsset]);

  const handleFundWithPrivy = useCallback(async () => {
    setFundingWithPrivy(true);
    setError(null);
    try {
      const result = await fundPotFromPrivyWallet(formId);
      setStats(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFundingWithPrivy(false);
    }
  }, [formId]);

  useEffect(() => {
    if (fundingMethod !== "privy" || !formId || privyWalletAddress) return;
    getCreatorPrivyWallet(formId)
      .then((wallet) => setPrivyWalletAddress(wallet.address))
      .catch((err) => setError((err as Error).message));
  }, [fundingMethod, formId, privyWalletAddress]);

  const handlePayWithCard = useCallback(async () => {
    setCheckingOut(true);
    setError(null);
    try {
      const returnUrl = window.location.href.split("?")[0];
      const { url } = await createFundingCheckoutSession(formId, `${returnUrl}?funded=1`, returnUrl);
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setCheckingOut(false);
    }
  }, [formId]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("funded") === "1" && formId) {
      refreshStats(formId);
    }
  }, [formId, refreshStats]);

  const configureDone = stats !== null;
  const fundDone = stats?.funded ?? false;
  const spentTinybar = stats ? (BigInt(stats.potTinybar) - BigInt(stats.remainingBudgetTinybar)).toString() : "0";
  const spendPct = stats && BigInt(stats.potTinybar) > BigInt(0)
    ? Number((BigInt(spentTinybar) * BigInt(1000)) / BigInt(stats.potTinybar)) / 10
    : 0;

  return (
    <main>
      <div className="top-bar">
        <Wordmark withTagline={!authenticated} />
        {ready && authenticated && (
          <div className="auth-pill">
            <span className="avatar">{initials(user?.email?.address ?? user?.wallet?.address ?? user?.id ?? "?")}</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {user?.email?.address ?? user?.wallet?.address ?? user?.id}
            </span>
            <button className="ghost" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </div>

      {!ready ? (
        <div className="card">
          <p className="hint">Loading…</p>
        </div>
      ) : !authenticated ? (
        <div className="card login-hero">
          <h1>Fund answers. Pay winners instantly.</h1>
          <p>
            Set a price per approved response, fund the pot once, and every real, verified respondent gets
            paid the second an AI agent approves their answer — no invoices, no manual payouts.
          </p>
          <button onClick={login}>Log in with Privy</button>
        </div>
      ) : (
        <>
          <div className="stepper">
            <div className={`step ${configureDone ? "done" : "active"}`}>
              <span className="step-dot">{configureDone ? "✓" : "1"}</span>
              <span className="step-label">Configure</span>
            </div>
            <div className={`step-line ${configureDone ? "done" : ""}`} />
            <div className={`step ${fundDone ? "done" : configureDone ? "active" : ""}`}>
              <span className="step-dot">{fundDone ? "✓" : "2"}</span>
              <span className="step-label">Fund</span>
            </div>
            <div className={`step-line ${fundDone ? "done" : ""}`} />
            <div className={`step ${fundDone ? "active" : ""}`}>
              <span className="step-dot">3</span>
              <span className="step-label">Track</span>
            </div>
          </div>

          <h2 className="section-title">
            <span className="section-num">1</span>Configure payout
          </h2>
          <div className="card">
            <label htmlFor="formId">Google Form ID</label>
            <input id="formId" value={formId} onChange={(e) => setFormId(e.target.value)} />

            <label htmlFor="price">Price per approved response (HBAR)</label>
            <input
              id="price"
              type="number"
              min="0"
              step="0.01"
              value={priceHbar}
              onChange={(e) => setPriceHbar(e.target.value)}
            />

            <label htmlFor="max">Max responses</label>
            <input
              id="max"
              type="number"
              min="1"
              value={maxResponses}
              onChange={(e) => setMaxResponses(Number(e.target.value))}
            />

            <button onClick={handleSave} disabled={saving}>
              {saving && <span className="spinner" />}
              {saving ? "Saving…" : configureDone ? "Update parameters" : "Save parameters"}
            </button>
            {error && <p className="error">⚠ {error}</p>}
          </div>

          {stats && (
            <>
              <h2 className="section-title">
                <span className="section-num">2</span>Fund the pot
              </h2>
              <div className="card">
                <span className={`badge ${stats.funded ? "funded" : "unfunded"}`}>
                  {stats.funded ? "Funded" : "Not funded yet"}
                </span>
                <p className="hint">
                  Pot needed: <strong>{tinybarToHbar(stats.potTinybar)} HBAR</strong> ({stats.maxResponses}{" "}
                  responses × {tinybarToHbar(stats.pricePerResponseTinybar)} HBAR)
                </p>
                {!stats.funded ? (
                  <>
                    <div className="tabs" style={{ marginTop: 14 }}>
                      <button
                        className={fundingMethod === "card" ? "" : "secondary"}
                        onClick={() => setFundingMethod("card")}
                      >
                        Card
                      </button>
                      <button
                        className={fundingMethod === "crypto" ? "" : "secondary"}
                        onClick={() => setFundingMethod("crypto")}
                      >
                        Send crypto
                      </button>
                      <button
                        className={fundingMethod === "privy" ? "" : "secondary"}
                        onClick={() => setFundingMethod("privy")}
                      >
                        Privy wallet
                      </button>
                    </div>

                    {fundingMethod === "card" ? (
                      <>
                        <p className="hint">
                          Stripe test-mode checkout — no real charge. The exact USD amount (a nominal peg,
                          since testnet HBAR has no real value) is shown on the next screen.
                        </p>
                        <button onClick={handlePayWithCard} disabled={checkingOut}>
                          {checkingOut && <span className="spinner" />}
                          {checkingOut ? "Redirecting to checkout…" : "Pay with card"}
                        </button>
                      </>
                    ) : fundingMethod === "privy" ? (
                      <>
                        <p className="hint">
                          A Privy-custodied wallet, provisioned just for this form. Send it{" "}
                          <strong>{tinybarToHbar(stats.potTinybar)} HBAR</strong> from a testnet faucet or
                          wallet of your own, then fund the pot with one click — the transfer out of this
                          wallet is authorized by a live Privy signature, not a key we hold ourselves.
                        </p>
                        <p className="mono">{privyWalletAddress ?? "Loading…"}</p>
                        <button onClick={handleFundWithPrivy} disabled={fundingWithPrivy || !privyWalletAddress}>
                          {fundingWithPrivy && <span className="spinner" />}
                          {fundingWithPrivy ? "Signing with Privy…" : "Fund from Privy wallet"}
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="tabs" style={{ marginBottom: 14 }}>
                          <button
                            className={cryptoAsset === "HBAR" ? "" : "secondary"}
                            onClick={() => setCryptoAsset("HBAR")}
                          >
                            HBAR
                          </button>
                          <button
                            className={cryptoAsset === "USDC" ? "" : "secondary"}
                            onClick={() => setCryptoAsset("USDC")}
                          >
                            Testnet USDC
                          </button>
                        </div>

                        {treasury && (
                          <>
                            <p style={{ fontSize: 14 }}>
                              Send{" "}
                              {cryptoAsset === "HBAR" ? (
                                <strong>{tinybarToHbar(stats.potTinybar)} HBAR</strong>
                              ) : (
                                <strong>
                                  $
                                  {((Number(tinybarToHbar(stats.potTinybar)) * treasury.usdCentsPerHbar) / 100).toFixed(
                                    2,
                                  )}{" "}
                                  worth of testnet USDC ({treasury.usdcTokenId})
                                </strong>
                              )}{" "}
                              to:
                            </p>
                            <p className="mono">{treasury.treasuryAccountId}</p>
                            {cryptoAsset === "USDC" && (
                              <p className="hint">
                                The treasury must be associated with this token to receive it — already done
                                for the deployed treasury account.
                              </p>
                            )}
                          </>
                        )}
                        <label htmlFor="txId">Transaction ID (after sending)</label>
                        <input
                          id="txId"
                          placeholder="0.0.xxxxx@1234567890.123456789"
                          value={fundingTxId}
                          onChange={(e) => setFundingTxId(e.target.value)}
                        />
                        <button onClick={handleVerifyFunding} disabled={verifying || !fundingTxId}>
                          {verifying && <span className="spinner" />}
                          {verifying ? "Checking Mirror Node…" : "Verify funding"}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <p className="hint mono" style={{ marginTop: 14 }}>
                    tx: {stats.fundingTransactionId}
                  </p>
                )}
              </div>

              <h2 className="section-title">
                <span className="section-num">3</span>Live dashboard
              </h2>
              <div className="card">
                <div className="stat-grid">
                  <div className="stat">
                    <div className="value">{stats.received}</div>
                    <div className="label">Responses received</div>
                  </div>
                  <div className="stat success">
                    <div className="value">{stats.approved}</div>
                    <div className="label">Approved &amp; paid</div>
                  </div>
                  <div className="stat danger">
                    <div className="value">{stats.rejected}</div>
                    <div className="label">Rejected by agent</div>
                  </div>
                  <div className="stat">
                    <div className="value">{tinybarToHbar(stats.remainingBudgetTinybar)}</div>
                    <div className="label">HBAR remaining</div>
                  </div>
                </div>

                {stats.funded && (
                  <>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${Math.min(100, spendPct)}%` }} />
                    </div>
                    <div className="progress-caption">
                      <span>{tinybarToHbar(spentTinybar)} HBAR paid out</span>
                      <span>{tinybarToHbar(stats.potTinybar)} HBAR pot</span>
                    </div>
                  </>
                )}
              </div>

              <h2 className="section-title">
                <span className="section-num">4</span>Responses
              </h2>
              <div className="card">
                {responses.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">○</div>
                    No responses yet — they&rsquo;ll show up here the instant one comes in.
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="responses-table">
                      <thead>
                        <tr>
                          <th>Respondent</th>
                          <th>Decision</th>
                          <th>Reasoning</th>
                          <th>Verification payment</th>
                          <th>Payout</th>
                          <th>Audit trail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {responses.map((r) => (
                          <tr key={r.responseId}>
                            <td>
                              <div className="respondent-cell">
                                <span className="avatar">{initials(r.respondentEmail)}</span>
                                {r.respondentEmail}
                              </div>
                            </td>
                            <td>
                              <span className={`badge ${r.decision === "APPROVE" ? "funded" : "rejected"}`}>
                                {r.decision === "APPROVE" ? "Approved" : "Rejected"}
                              </span>
                            </td>
                            <td className="hint">{r.reasoning}</td>
                            <td>
                              {r.x402TransactionId ? (
                                <HashChip value={r.x402TransactionId} href={hashscanTransactionUrl(r.x402TransactionId)} />
                              ) : (
                                <span className="hint">—</span>
                              )}
                            </td>
                            <td>
                              {r.payoutTransactionId ? (
                                <HashChip
                                  value={r.payoutTransactionId}
                                  href={hashscanTransactionUrl(r.payoutTransactionId)}
                                />
                              ) : r.decision === "APPROVE" ? (
                                <span className="hint">not claimed yet</span>
                              ) : (
                                <span className="hint">—</span>
                              )}
                            </td>
                            <td>
                              {r.hcsTransactionId ? (
                                <HashChip
                                  value={r.hcsTransactionId}
                                  href={hashscanTransactionUrl(r.hcsTransactionId)}
                                  label={`#${r.hcsSequenceNumber}`}
                                />
                              ) : (
                                <span className="hint">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
