"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import {
  createFundingCheckoutSession,
  type FormStats,
  type FundingAsset,
  fundPotFromPrivyWallet,
  getCreatorPrivyWallet,
  getStats,
  getTreasuryAccountId,
  hbarToTinybar,
  saveFormConfig,
  tinybarToHbar,
  verifyFunding,
} from "@/lib/orchestrator";

export default function CreatorConsole() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  const [formId, setFormId] = useState("demo-form-1");
  const [priceHbar, setPriceHbar] = useState("1");
  const [maxResponses, setMaxResponses] = useState(300);
  const [stats, setStats] = useState<FormStats | null>(null);
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
      const result = await saveFormConfig({
        formId,
        pricePerResponseTinybar: hbarToTinybar(priceHbar),
        maxResponses,
      });
      setStats(result);
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

  return (
    <main>
      <h1>FormDrop</h1>
      <p className="hint">Fund a payout pot for your Google Form. Respondents get paid the instant they submit a valid response.</p>

      <div className="card">
        {!ready ? (
          <p>Loading…</p>
        ) : authenticated ? (
          <>
            <p>
              Signed in as <strong>{user?.email?.address ?? user?.wallet?.address ?? user?.id}</strong>
            </p>
            <button className="secondary" onClick={logout}>
              Log out
            </button>
          </>
        ) : (
          <>
            <p>Log in to manage your form&rsquo;s payout pot.</p>
            <button onClick={login}>Log in with Privy</button>
          </>
        )}
      </div>

      {authenticated && (
        <>
          <h2>1. Set payout parameters</h2>
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
              {saving ? "Saving…" : "Save parameters"}
            </button>
            {error && <p className="error">{error}</p>}
          </div>
        </>
      )}

      {stats && (
        <>
          <h2>2. Fund the pot</h2>
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
                <div className="tabs">
                  <button
                    className={fundingMethod === "card" ? "" : "secondary"}
                    onClick={() => setFundingMethod("card")}
                  >
                    Pay with card
                  </button>
                  <button
                    className={fundingMethod === "crypto" ? "" : "secondary"}
                    onClick={() => setFundingMethod("crypto")}
                  >
                    Send crypto myself
                  </button>
                  <button
                    className={fundingMethod === "privy" ? "" : "secondary"}
                    onClick={() => setFundingMethod("privy")}
                  >
                    Fund from Privy wallet
                  </button>
                </div>

                {fundingMethod === "card" ? (
                  <>
                    <p className="hint">
                      Stripe test-mode checkout — no real charge. The exact USD amount (a nominal peg,
                      since testnet HBAR has no real value) is shown on the next screen.
                    </p>
                    <button onClick={handlePayWithCard} disabled={checkingOut}>
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
                      {fundingWithPrivy ? "Signing with Privy…" : "Fund from Privy wallet"}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="tabs">
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
                        <p>
                          Send{" "}
                          {cryptoAsset === "HBAR" ? (
                            <strong>{tinybarToHbar(stats.potTinybar)} HBAR</strong>
                          ) : (
                            <strong>
                              ${((Number(tinybarToHbar(stats.potTinybar)) * treasury.usdCentsPerHbar) / 100).toFixed(2)}{" "}
                              worth of testnet USDC ({treasury.usdcTokenId})
                            </strong>
                          )}{" "}
                          to:
                        </p>
                        <p className="mono">{treasury.treasuryAccountId}</p>
                        {cryptoAsset === "USDC" && (
                          <p className="hint">
                            The treasury must be associated with this token to receive it — already done for
                            the deployed treasury account.
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
                      {verifying ? "Checking Mirror Node…" : "Verify funding"}
                    </button>
                  </>
                )}
              </>
            ) : (
              <p className="hint mono">tx: {stats.fundingTransactionId}</p>
            )}
          </div>

          <h2>3. Live dashboard</h2>
          <div className="card">
            <div className="stat-grid">
              <div className="stat">
                <div className="value">{stats.received}</div>
                <div className="label">Responses received</div>
              </div>
              <div className="stat">
                <div className="value">{stats.approved}</div>
                <div className="label">Approved &amp; paid</div>
              </div>
              <div className="stat">
                <div className="value">{stats.rejected}</div>
                <div className="label">Rejected by agent</div>
              </div>
              <div className="stat">
                <div className="value">{tinybarToHbar(stats.remainingBudgetTinybar)}</div>
                <div className="label">HBAR remaining</div>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
