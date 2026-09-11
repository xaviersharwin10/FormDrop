# FormDrop

A Google Forms add-on that pays respondents the instant they submit a valid
response. The form creator funds a payout pot; an AI agent judges response
quality; approved respondents get paid in seconds via Hedera settlement,
without ever seeing a wallet, seed phrase, or the word "crypto."

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026).

> Status: early scaffold, actively being built. This README will grow to
> cover full setup, architecture, and the payment flow as pieces land — see
> `specs/DECISIONS.md` for the planning log and `specs/PROJECT.md` for the
> full project description.

## Why this, why Web3

Paid surveys have been tried before — as new standalone platforms nobody
adopted. This ships inside the tool 700M+ people already use (Google Forms),
with an AI agent that makes instant payout *safe* instead of an instant
fraud vector, and a one-time World ID Selfie Check that prevents one person
draining the pot under many fake emails. Sub-dollar, cross-border,
instant-settlement payouts to strangers aren't possible on card rails; Hedera
makes them possible at near-zero cost.

## Architecture

Two loops:

**Loop 1 — Response → Verification → Proof**

```
Google Form submit
  -> Apps Script onFormSubmit (installable trigger)
  -> UrlFetchApp.fetch() POST -> orchestrator service
  -> orchestrator pays resource-server via x402 (Blocky402 facilitator, Hedera testnet)
  -> resource-server runs the LLM quality/fraud judgment, returns verdict
  -> orchestrator anchors verdict + payload hash to Hedera Consensus Service (HCS)
```

**Loop 2 — Approval → Identity → Payout**

```
Verdict = APPROVE
  -> claim email sent to respondent
  -> respondent clicks -> World ID Selfie Check (proves unique personhood)
  -> Privy embedded wallet looked up / provisioned by email
  -> payout settles on Hedera
  -> creator dashboard updates live
```

## Repo layout

```
apps/
  web/            Next.js — creator console + respondent claim page (Selfie Check -> payout)
  apps-script/    Container-bound Google Apps Script (clasp-managed)
services/
  resource-server/  Fastify — x402-gated verification service (the "service" being sold)
  orchestrator/     Fastify — webhook receiver, paying x402 client, HCS anchoring, payouts, email
packages/
  db/             Postgres schema + client (shared by resource-server, orchestrator, web)
  shared/         Shared TypeScript types/utilities
specs/            Planning docs and AI-assisted-workflow disclosure artifacts
```

## Sponsor integrations

- **Hedera (AI & Agentic Payments track):** `resource-server` hosts a live
  x402-gated verification endpoint on Hedera testnet, settled through the
  Blocky402 facilitator; `orchestrator` is the paying client. Verdicts are
  anchored to HCS as a verifiable audit trail.
- **Privy (Best B2B financial product + Best financial flow):** respondent
  payout wallets (receive-only, policy-gated) for claim-to-payout, and a
  creator-side pot-funding wallet, owned by a key quorum and gated by that
  authorization key, where the funding transfer itself is signed through
  Privy's `secp256k1_sign` RPC and executed as a real Hedera transaction —
  not just custody.
- **World (Selfie Check):** gates the claim step to prove unique personhood
  and prevent pot-draining via fake-email farming.

## Setup

Requires Node.js 20+ and pnpm.

```
pnpm install
```

### Hedera testnet + Blocky402 (resource-server and orchestrator)

1. Create a testnet account at [portal.hedera.com](https://portal.hedera.com)
   (free, instant, includes test HBAR). Grab the **ECDSA** private key, not
   ED25519 — `@x402/hedera` requires `PrivateKey.fromStringECDSA`.
2. `cp services/resource-server/.env.example services/resource-server/.env`
   — set `HEDERA_PAY_TO_ACCOUNT_ID` to the account that should *receive*
   verification payments (public account ID only, no key needed here).
3. `cp services/orchestrator/.env.example services/orchestrator/.env` — set
   `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` to the account that *pays* for
   verification calls.
4. Start the resource server: `pnpm dev:resource-server` (listens on
   `:4001`).
5. Prove one real x402 payment end to end: `pnpm --filter
   @formdrop/orchestrator spike`. Expect: a 402 challenge from the live
   Blocky402 facilitator on `hedera:testnet`, an automatic signed retry, a
   settled transaction, and a real LLM verification verdict.

No Blocky402 API key is required — the facilitator
(`https://api.testnet.blocky402.com`) is open access.

**Proof this works end to end:** transaction
`0.0.7162784-1788964944-181581350` on Hedera testnet — a real x402 payment
settled through Blocky402 for one verification call. Check it yourself on
the public Mirror Node:
[api/v1/transactions/0.0.7162784-1788964944-181581350](https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1788964944-181581350).

### LLM verification (Google Gemini, free tier)

1. Grab a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   — no billing required for the free tier used here.
2. Add `GEMINI_API_KEY` to `services/resource-server/.env`.

`resource-server/src/verify.ts` calls `gemini-3.6-flash` with structured JSON
output (schema derived from the same `zod` verdict shape used everywhere
else) to judge each response: genuine vs. gibberish, duplicate/near-duplicate
against recent prior answers to the same form, obviously-LLM-generated
boilerplate, and suspiciously-fast completion. This is the actual anti-fraud
gate — the orchestrator pays for this judgment via x402 regardless of the
verdict; only `APPROVE` makes the respondent's payout eligible.

**Proof this works end to end:** three distinct cases run through the full
webhook -> x402 -> Gemini pipeline, not just the LLM in isolation:

| Input | Verdict | Why |
|---|---|---|
| `"ok good nice yes fine"`, 1s | `REJECT` | `isGibberish` + `isSuspiciouslyFast`, confidence 0.98 |
| A specific, realistic answer, 88s | `APPROVE` | confidence 0.98, reasoning cites the concrete detail given |
| Two-word edit of a prior answer | `REJECT` | `isDuplicateOrNearDuplicate`, reasoning names the exact overlap |

Each settled a real, separate Hedera testnet transaction
(`0.0.7162784@1789002671.381366556`, `0.0.7162784@1789002697.084483608`) —
check either on the Mirror Node, e.g.
[api/v1/transactions/0.0.7162784-1789002671-381366556](https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1789002671-381366556).

### Claim email (Gmail SMTP)

1. Enable 2-Step Verification on the sending Gmail account, then generate
   an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
2. Add `GMAIL_USER` and `GMAIL_APP_PASSWORD` to
   `services/orchestrator/.env`. Optionally set `WEB_APP_URL` (defaults to
   `http://localhost:3000`).

The moment `handleFormSubmit` records an `APPROVE` verdict, it fires an
email (`services/orchestrator/src/email.ts`, via `nodemailer`) containing
the respondent's claim link — fire-and-forget, so a slow or bounced email
can never turn a successful paid verification into a webhook failure.

Originally built on Resend; switched after a real Google Form test showed
Resend's test-mode sender only delivers to the Resend account's own
email, not arbitrary respondents — see `specs/DECISIONS.md`
(2026-09-11) for how that was caught and fixed.

**Proof this works end to end:** a real Google Form submission — not a
simulated `curl` — drove a real webhook call, a real x402 payment on
Hedera testnet, a real Gemini `APPROVE`, and a real email delivered to a
third-party inbox (not the sending account's own) with a working claim
link.

### HCS audit trail (verification verdicts, verifiable on-chain)

1. Run once: `pnpm --filter @formdrop/orchestrator hcs:setup-topic` —
   creates the public HCS topic and prints a `HCS_AUDIT_TOPIC_ID` to add to
   `services/orchestrator/.env`.

Every verification call anchors a message to this topic: `formId`,
`responseId`, a SHA-256 hash of the response payload (not the raw payload —
keeps respondent PII off a public ledger), the full verdict, and the x402
transaction id that paid for the judgment. The topic has no admin/submit
key — anyone, including a judge, can query it directly on the Mirror Node
with no keys of ours required.

**Proof this works end to end:** topic
[`0.0.10460886`](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10460886),
message 1 — fetched straight from the Mirror Node and base64-decoded:
[api/v1/topics/0.0.10460886/messages/1](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10460886/messages/1).
The decoded content is the exact audit record from a real webhook request,
including the real Gemini reasoning text and the real x402 payment
transaction id.

### Privy (respondent payout wallets)

1. Create an app at [privy.io](https://privy.io) — free tier — and grab the
   App ID and App Secret.
2. Add `PRIVY_APP_ID` / `PRIVY_APP_SECRET` to
   `services/orchestrator/.env`.
3. Run once: `pnpm --filter @formdrop/orchestrator privy:setup-policy` —
   creates the receive-only policy applied to every respondent wallet, and
   prints a `PRIVY_RESPONDENT_POLICY_ID` to add to `.env`.
4. Prove the payout path end to end: `pnpm --filter @formdrop/orchestrator
   privy:spike` — provisions a Privy embedded wallet by email (no wallet UI)
   and pays it real testnet HBAR.

Privy has no native Hedera wallet type, so this uses Hedera's EVM-address
auto-account-creation (HIP-583): a Privy `ethereum`-type wallet's address is
paid directly, and Hedera creates a receive-only "hollow" account for it on
first receipt. See `specs/DECISIONS.md` for the full reasoning.

**Proof this works end to end:** Privy wallet
`0xc24034467b7986d5daf89257911d1965020f422c` was provisioned by email and
paid 0.001 HBAR — Hedera auto-created account `0.0.10441626` for it. Check
it on the Mirror Node:
[api/v1/accounts/0xc24034467b7986d5daf89257911d1965020f422c](https://testnet.mirrornode.hedera.com/api/v1/accounts/0xc24034467b7986d5daf89257911d1965020f422c).

### Creator console (apps/web)

1. `cp apps/web/.env.local.example apps/web/.env.local` — set
   `NEXT_PUBLIC_PRIVY_APP_ID` to the same Privy App ID used above (client-safe;
   never put the App Secret in this app).
2. With resource-server and orchestrator both running, `pnpm
   --filter @formdrop/web dev` (listens on `:3000`).
3. Log in (creates your creator embedded wallet), set a price per response
   and max responses, then fund the pot one of three ways:
   - **Pay with card** — real Stripe Checkout (test mode), no crypto
     knowledge required. On successful payment, a webhook marks the form
     funded; the treasury (still the orchestrator's own Hedera operator
     account) is what actually pays respondents out in testnet HBAR. See
     the Stripe setup section below.
   - **Send crypto yourself** — for anyone who already holds crypto:
     native testnet HBAR, or testnet USDC if they'd rather not hold a
     volatile-priced asset. Send it to the shown treasury account and
     paste the transaction id, checked against the Mirror Node, not just
     taken on faith.
   - **Fund from Privy wallet** — a Privy-custodied wallet provisioned per
     form. Send it testnet HBAR, then fund with one click: the transfer out
     of that wallet into the treasury is authorized by a live Privy
     signature, not a key the orchestrator holds. See the Privy-signed
     funding section below.
   The dashboard below polls orchestrator's `/forms/:formId/stats` live.

### Card funding (Stripe, test mode)

1. Grab a free test-mode secret key at
   [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys)
   — no billing setup needed. Add `STRIPE_SECRET_KEY` to
   `services/orchestrator/.env`.
2. Register a webhook endpoint for `checkout.session.completed` pointing at
   `<orchestrator-url>/webhooks/stripe`, and add its signing secret as
   `STRIPE_WEBHOOK_SECRET`. While developing locally without a public URL,
   the [Stripe CLI](https://stripe.com/docs/stripe-cli)'s `stripe listen
   --forward-to localhost:4002/webhooks/stripe` prints a usable secret.
3. `USD_CENTS_PER_HBAR` (default 100, i.e. $1/HBAR) is a nominal peg only —
   testnet HBAR has no real value, so this exists purely to give the card
   charge a coherent USD amount.

**Proof this works end to end:** a real Checkout Session was created
against the live Stripe API for a 3-HBAR pot ($3.00 at the default peg),
independently confirmed by re-fetching the session from Stripe's own API
(`amount_total: 300`, correct `formId`/`potTinybar` metadata). The webhook
handler was verified against a properly Stripe-signed test event (via
Stripe's own `generateTestHeaderString` helper, since no public URL exists
yet for a live redirect) — it correctly marked the form funded
(`fundingTransactionId: "stripe:cs_test_..."`) — and a forged signature was
independently confirmed to be rejected (`400 invalid signature`), proving
the check is real, not decorative.

### Stablecoin crypto funding (testnet USDC)

Alongside native HBAR, the "send crypto yourself" path also accepts
testnet USDC (`0.0.429274`) — for creators who'd rather fund with a
stable-priced asset than native HBAR. Requires a one-time association so
the treasury account can receive it: `pnpm --filter @formdrop/orchestrator
hedera:associate-usdc`.

**Proof this works end to end:** the association transaction is real,
independently confirmed on the Mirror Node before (not associated) and
after (associated, 0 balance). The verification logic
(`verifyIncomingTokenTransfer`) was tested against a real, independent
USDC transfer already on testnet — exact match, amount-too-high,
wrong-recipient, and wrong-token-id cases all resolved correctly — and the
live HTTP route (`POST /forms/:formId/verify-funding` with `"asset":
"USDC"`) was exercised the same way, correctly returning a 422 with the
exact computed minimum required. Not yet exercised: an actual USDC
transfer landing in the treasury itself, since that needs testnet USDC in
hand (Circle's faucet requires signing up for a separate account, not done
without asking first) — noted honestly rather than claimed as proven.

### Privy-signed pot funding (creator wallet → treasury)

A third funding path where the *fund-the-pot transfer itself* executes
through Privy, not just wallet custody: the orchestrator provisions a Privy
wallet per form (`GET /forms/:formId/privy-wallet`), the creator sends it
testnet HBAR, and `POST /forms/:formId/fund/privy-transfer` builds a real
Hedera `TransferTransaction` moving that HBAR into the treasury, signed via
a bridge (`services/orchestrator/src/hederaPrivySigner.ts`) between Privy's
raw `secp256k1_sign` RPC and Hedera's external-signer `Transaction.signWith`
— both confirmed from the installed SDKs' own source, not assumed.

This wallet is also locked down with a real Privy control: its `owner_id`
is a **key quorum** — a P-256 authorization key our server holds, generated
once via `pnpm --filter @formdrop/orchestrator privy:setup-creator-authorization-key`
(prints `PRIVY_CREATOR_KEY_QUORUM_ID` and
`PRIVY_CREATOR_AUTHORIZATION_PRIVATE_KEY` to add to `.env`). Once set,
Privy itself requires every mutating call against that wallet — including
the raw-sign RPC the funding bridge uses — to carry a signature computed
with that key; holding the app secret alone is no longer enough. (The
simpler Privy *policy* mechanism, used for the respondent wallet below,
can't gate this wallet the same way — `secp256k1_sign` isn't a nameable
policy method in the installed SDK; a key quorum is the right tool here,
not a workaround. See `specs/DECISIONS.md` for the full reasoning.)

**Proof this works end to end:** provisioned a real Privy wallet
(`0xdDB5F014dB67a754A911b52c9C76D862D70b9717`), sent it real testnet HBAR,
then called the funding endpoint — it recovered the wallet's public key via
ECDSA signature recovery (Privy never exposes it directly), signed a real
transfer transaction through Privy with the key-quorum authorization
attached, and got back a real `SUCCESS` receipt
(`0.0.10439799@1789137988.901478637`) on the first attempt. Separately
confirmed the control is real, not decorative: the same RPC call *without*
the authorization signature was rejected by Privy's live API with a `401`.

### World ID (Selfie Check on claim)

1. Create an app at [developer.world.org](https://developer.world.org) —
   grab `app_id`, `rp_id`, and `signing_key` (keep the signing key secret,
   server-side only).
2. Selfie Check needs an extra feature flag enabled by a World rep even for
   sandbox testing — request it through your World point of contact before
   expecting a real claim to succeed.
3. Add `WORLD_APP_ID` / `WORLD_RP_ID` / `WORLD_SIGNING_KEY` to
   `services/orchestrator/.env` (`WORLD_ENVIRONMENT=sandbox` while access is
   pending).
4. The respondent claim page lives at `apps/web`'s `/claim?formId=<id>&responseId=<id>`
   — reachable once a response has been APPROVE'd through the webhook path.

**Proof this works end to end:** done for real, on a physical device.
Sandbox app installed on Android, claim page opened in a browser, QR code
scanned, a real Selfie Check completed — the claim page showed a paid
wallet and transaction id. Independently confirmed on the Mirror Node:
wallet `0xF74850796781F2333D60aE8Ec0CD577c80891576` resolved to Hedera
account `0.0.10442744`, credited 100,000 tinybars via a real
`CRYPTOTRANSFER`:
[api/v1/accounts/0xf74850796781f2333d60ae8ec0cd577c80891576](https://testnet.mirrornode.hedera.com/api/v1/accounts/0xf74850796781f2333d60ae8ec0cd577c80891576).
Re-claiming the same response is correctly rejected (`"already claimed"`).

## License

TBD.
