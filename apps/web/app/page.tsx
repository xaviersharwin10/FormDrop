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
  getFormsForCreator,
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
import { LogoMark, Wordmark } from "@/components/Logo";

function initials(input: string): string {
  const at = input.indexOf("@");
  const namePart = at > 0 ? input.slice(0, at) : input;
  return namePart.slice(0, 2).toUpperCase();
}

type View = "list" | "new" | "detail";

export default function CreatorConsole() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const creatorId = user?.id ?? null;

  const [view, setView] = useState<View>("list");
  const [forms, setForms] = useState<FormStats[] | null>(null);
  const [loadingForms, setLoadingForms] = useState(false);

  const [formId, setFormId] = useState("");
  const [priceHbar, setPriceHbar] = useState("1");
  const [maxResponses, setMaxResponses] = useState(300);
  const [showEditor, setShowEditor] = useState(true);

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

  const loadForms = useCallback(async (id: string) => {
    setLoadingForms(true);
    try {
      setForms(await getFormsForCreator(id));
    } catch {
      setForms([]);
    } finally {
      setLoadingForms(false);
    }
  }, []);

  useEffect(() => {
    if (authenticated && creatorId) loadForms(creatorId);
  }, [authenticated, creatorId, loadForms]);

  const refreshStats = useCallback(async (id: string) => {
    try {
      setStats(await getStats(id));
      setResponses(await getResponses(id));
    } catch {
      // form not configured yet on the orchestrator — fine, ignore until saved
    }
  }, []);

  useEffect(() => {
    if (view !== "detail" || !stats) return;
    const interval = setInterval(() => refreshStats(stats.formId), 4000);
    return () => clearInterval(interval);
  }, [view, stats, refreshStats]);

  const openForm = useCallback((form: FormStats) => {
    setStats(form);
    setFormId(form.formId);
    setPriceHbar(tinybarToHbar(form.pricePerResponseTinybar));
    setMaxResponses(form.maxResponses);
    setShowEditor(!form.funded);
    setResponses([]);
    setTreasury(null);
    setPrivyWalletAddress(null);
    setFundingTxId("");
    setError(null);
    setView("detail");
    getResponses(form.formId).then(setResponses).catch(() => {});
    getTreasuryAccountId(form.formId).then(setTreasury).catch(() => {});
  }, []);

  const startNewForm = useCallback(() => {
    setStats(null);
    setFormId("");
    setPriceHbar("1");
    setMaxResponses(300);
    setShowEditor(true);
    setResponses([]);
    setTreasury(null);
    setError(null);
    setView("new");
  }, []);

  const backToList = useCallback(() => {
    setView("list");
    if (creatorId) loadForms(creatorId);
  }, [creatorId, loadForms]);

  const handleSave = useCallback(async () => {
    if (!creatorId) return;
    setSaving(true);
    setError(null);
    try {
      await saveFormConfig({
        formId,
        pricePerResponseTinybar: hbarToTinybar(priceHbar),
        maxResponses,
        creatorId,
      });
      // saveFormConfig's response is just the raw form config (no
      // potTinybar/received/approved/etc — those are computed only by
      // /stats), so fetch the full stats shape instead of using it directly.
      const fresh = await getStats(formId);
      setStats(fresh);
      setTreasury(await getTreasuryAccountId(formId));
      setView("detail");
      setShowEditor(!fresh.funded);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [formId, priceHbar, maxResponses, creatorId]);

  const handleVerifyFunding = useCallback(async () => {
    setVerifying(true);
    setError(null);
    try {
      const result = await verifyFunding(formId, fundingTxId.trim(), cryptoAsset);
      setStats(result);
      setShowEditor(false);
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
      setShowEditor(false);
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

  const spentTinybar = stats ? (BigInt(stats.potTinybar) - BigInt(stats.remainingBudgetTinybar)).toString() : "0";
  const spendPct = stats && BigInt(stats.potTinybar) > BigInt(0)
    ? Number((BigInt(spentTinybar) * BigInt(1000)) / BigInt(stats.potTinybar)) / 10
    : 0;

  return (
    <main>
      <div className="navbar">
        <div className="navbar-inner">
          <Wordmark withTagline={false} />
          {ready && authenticated ? (
            <div className="auth-pill">
              <span className="avatar">{initials(user?.email?.address ?? user?.wallet?.address ?? user?.id ?? "?")}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {user?.email?.address ?? user?.wallet?.address ?? user?.id}
              </span>
              <button className="ghost" onClick={logout}>
                Log out
              </button>
            </div>
          ) : ready ? (
            <button onClick={login}>Log in with Privy</button>
          ) : null}
        </div>
      </div>

      {!ready ? (
        <div className="shell">
          <p className="hint">Loading…</p>
        </div>
      ) : !authenticated ? (
        <>
          <div className="shell">
            <div className="hero">
              <div className="hero-inner">
                <span className="hero-eyebrow">Built on Hedera · Privy · World ID</span>
                <h1>Turn every Google Form into an instant payout.</h1>
                <p className="hero-sub">
                  Google Forms already has 700M+ monthly users. FormDrop pays real respondents the moment an
                  AI agent verifies their answer and World ID confirms they&rsquo;re a unique human —
                  settled on Hedera in seconds. No wallet setup, no seed phrase, no crypto knowledge required.
                </p>
                <div className="hero-cta-row">
                  <button onClick={login}>Log in with Privy to get started</button>
                </div>
              </div>

              <div className="stat-pill-row">
                <div className="stat-pill">
                  <div className="stat-pill-value">700M+</div>
                  <div className="stat-pill-label">Built-in reach, zero acquisition cost</div>
                </div>
                <div className="stat-pill">
                  <div className="stat-pill-value">&lt;10s</div>
                  <div className="stat-pill-label">From submit to settled payout</div>
                </div>
                <div className="stat-pill">
                  <div className="stat-pill-value">$0.01</div>
                  <div className="stat-pill-label">Per AI verification, pay-per-call</div>
                </div>
              </div>
            </div>

            <div className="how-it-works">
              <div className="how-step">
                <span className="how-step-num">1</span>
                <h3>Configure &amp; fund</h3>
                <p>Set a price per approved response and fund the pot once — by card, crypto, or a Privy wallet.</p>
              </div>
              <div className="how-step">
                <span className="how-step-num">2</span>
                <h3>Respondents answer</h3>
                <p>An AI agent judges quality and fraud signals in real time; every verdict is anchored on Hedera.</p>
              </div>
              <div className="how-step">
                <span className="how-step-num">3</span>
                <h3>Instant, walletless payout</h3>
                <p>A quick World ID Selfie Check proves uniqueness, and the payout lands — no crypto knowledge needed.</p>
              </div>
            </div>

            <div className="pitch-banner">
              <h2>This is what mainstream crypto adoption actually looks like.</h2>
              <p>
                Not another wallet app competing for attention — real, instant money moving to real people
                through a tool 700 million of them already use every day. FormDrop meets people where they
                already are, and lets Hedera, World ID, and Privy do the trust work invisibly underneath.
              </p>
            </div>
          </div>
        </>
      ) : view === "list" ? (
        <div className="shell">
          <div className="forms-toolbar">
            <h1>Your forms</h1>
          </div>
          {loadingForms ? (
            <p className="hint">Loading your forms…</p>
          ) : (
            <div className="forms-grid">
              <button className="new-form-tile" onClick={startNewForm}>
                <span className="plus-icon">+</span>
                New form
              </button>
              {forms?.map((f) => (
                <div
                  key={f.formId}
                  className="form-tile"
                  onClick={() => openForm(f)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openForm(f)}
                  role="button"
                  tabIndex={0}
                >
                  <span className={`badge ${f.funded ? "funded" : "unfunded"}`}>
                    {f.funded ? "Funded" : "Not funded"}
                  </span>
                  <div className="form-tile-id">{f.formId}</div>
                  <div className="form-tile-stats">
                    <div>
                      <div className="value">{f.received}</div>
                      <div className="label">Received</div>
                    </div>
                    <div>
                      <div className="value">{f.approved}</div>
                      <div className="label">Approved</div>
                    </div>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${
                          BigInt(f.potTinybar) > BigInt(0)
                            ? Math.min(
                                100,
                                Number(
                                  ((BigInt(f.potTinybar) - BigInt(f.remainingBudgetTinybar)) * BigInt(1000)) /
                                    BigInt(f.potTinybar),
                                ) / 10,
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {forms?.length === 0 && !loadingForms && (
            <p className="hint" style={{ marginTop: 14 }}>
              No forms yet — create your first one to fund a payout pot.
            </p>
          )}
        </div>
      ) : (
        <div className="shell">
          <div className="detail-header">
            <div className="detail-header-left">
              <button className="ghost" onClick={backToList}>
                ← Your forms
              </button>
              {stats && (
                <>
                  <LogoMark size={22} />
                  <span className="form-id-tag">{stats.formId}</span>
                  <span className={`badge ${stats.funded ? "funded" : "unfunded"}`}>
                    {stats.funded ? "Funded" : "Not funded yet"}
                  </span>
                </>
              )}
            </div>
          </div>

          {view === "new" || !stats?.funded ? (
            <>
              <h2 className="section-title">
                <span className="section-num">1</span>
                Configure payout
                {stats && (
                  <button className="ghost" style={{ marginLeft: "auto" }} onClick={() => setShowEditor((v) => !v)}>
                    {showEditor ? "Hide" : "Edit"}
                  </button>
                )}
              </h2>
              {(showEditor || !stats) && (
                <div className="card">
                  <label htmlFor="formId">Google Form ID</label>
                  <input
                    id="formId"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value)}
                    disabled={!!stats}
                    placeholder="1FAIpQLS…"
                  />

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

                  <button onClick={handleSave} disabled={saving || !formId}>
                    {saving && <span className="spinner" />}
                    {saving ? "Saving…" : stats ? "Update parameters" : "Save parameters"}
                  </button>
                  {error && <p className="error">⚠ {error}</p>}
                </div>
              )}
            </>
          ) : null}

          {stats && (
            <>
              {!stats.funded && (
                <>
                  <h2 className="section-title">
                    <span className="section-num">2</span>Fund the pot
                  </h2>
                  <div className="card">
                    <p className="hint">
                      Pot needed: <strong>{tinybarToHbar(stats.potTinybar)} HBAR</strong> ({stats.maxResponses}{" "}
                      responses × {tinybarToHbar(stats.pricePerResponseTinybar)} HBAR)
                    </p>
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
                        <div className="tabs" style={{ marginBottom: 14, marginTop: 14 }}>
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
                    {error && <p className="error">⚠ {error}</p>}
                  </div>
                </>
              )}

              <h2 className="section-title">
                <span className="section-num">{stats.funded ? "1" : "3"}</span>Live dashboard
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
                <span className="section-num">{stats.funded ? "2" : "4"}</span>Responses
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
        </div>
      )}
    </main>
  );
}
