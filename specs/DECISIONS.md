# Planning & decisions log

This repo uses AI-assisted development (Claude Code). Per the event's disclosure
requirement, planning artifacts and key architectural decisions are kept here
instead of only living in chat history.

## 2026-09-09 — Initial architecture decisions

- **Monorepo:** pnpm workspaces, TypeScript throughout.
- **Backend split into two services** (matches the Hedera track's literal
  requirement to host a protected resource server *and* build the client that
  pays for it):
  - `services/resource-server` — Fastify. Hosts the x402-gated verification
    endpoint (the "service" being sold). Returns HTTP 402 until paid via the
    Blocky402 facilitator on Hedera testnet.
  - `services/orchestrator` — Fastify. Receives the Apps Script `onFormSubmit`
    webhook, acts as the paying x402 client against `resource-server`, runs
    the LLM judgment prompt, anchors verdicts to HCS, triggers Privy payouts,
    sends claim emails.
- **Web app:** `apps/web` — Next.js. Two audiences in one app:
  - Creator: connect/create Privy wallet, fund pot, set parameters, live
    dashboard (received/approved/rejected/remaining budget).
  - Respondent: claim page (World ID Selfie Check → Privy wallet lookup →
    payout).
- **Apps Script:** `apps/apps-script` — container-bound script source,
  managed with `clasp`. `onFormSubmit` installable trigger POSTs to
  `orchestrator`.
- **Database:** Postgres (Neon or Supabase free tier), accessed via
  `packages/db`. Stores form config, responses, verdicts, HCS transaction
  IDs, claim status, wallet mappings.
- **Shared code:** `packages/shared` — types and utilities shared across
  services (response payload shape, verdict shape, etc).

## Sponsor accounts status (as of 2026-09-09)

- World ID sandbox: already secured.
- Hedera testnet account (ID + ECDSA key) and Privy app (ID + secret): not
  yet created — needed before the Day 1 Blocky402 spike and before wallet
  work respectively.

## 2026-09-09 — Day-1 spike: real x402 payment settled on Hedera testnet

Priority #1 from the build plan is done. `pnpm --filter @formdrop/orchestrator spike`
settles a real payment against the live Blocky402 facilitator
(`https://api.testnet.blocky402.com`, no API key). Verified independently on
the public Mirror Node — transaction `0.0.7162784-1788964944-181581350`,
`CRYPTOTRANSFER`, `SUCCESS`, 100,000 tinybars moved from the orchestrator's
account to the resource-server's payTo account, facilitator fee-payer
(`0.0.7162784`) covering the network fee.

Two gotchas hit along the way, worth remembering:

- **Payer and payTo must be different Hedera accounts.** Using the same
  account for both produced `invalid_exact_hedera_payload_amount_mismatch`
  from the facilitator — a self-transfer doesn't construct correctly. This
  isn't just a testing workaround, either: it matches the real architecture,
  where the orchestrator's operating wallet and the resource-server's
  treasury are legitimately different accounts.
- **`x402Client`'s default spend controls reject HBAR.** It only allows
  "default assets" (recognized stablecoins) up to $1/payment unless told
  otherwise. HBAR on `hedera:testnet` needed an explicit `allowedAssets`
  entry (see `services/orchestrator/src/x402Client.ts`) rather than
  disabling spend controls outright — kept a sanity cap on it instead of
  `spendControls: false`.

Also found via a WebFetch of the Blocky402 docs and cross-checked against another
public ETHOnline 2026 repo using the same facilitator: it can return
`DUPLICATE_TRANSACTION` on `/settle` retries. Not hit yet, but if it comes up,
the fix is checking the Hedera Mirror Node directly for a prior
`CRYPTOTRANSFER SUCCESS` with the claimed transaction id before treating it
as a real failure (payment success and delivery are different questions).

## 2026-09-09 — Named the project FormDrop

Working name in the brief was "Paid Forms" — literal but not distinctive.
Renamed to **FormDrop** (forms + an instant payout "drop"): short, one word,
easy to say in a 2-4 minute demo video, doesn't require explaining what it
means. `specs/PROJECT_BRIEF.md` keeps the original wording throughout since
it's the source planning artifact; everything else (package scope
`@formdrop/*`, README, repo) uses the new name.

## 2026-09-09 — Day-2 (partial): real webhook -> paid verification path

`POST /webhook/form-submit` on orchestrator is now real, not a stub: it
validates the payload shape (rejecting bad input before paying anything),
calls resource-server's `/verify` through the x402 client, records the
result, and returns the verdict. Smoke-tested against both live services —
a webhook POST triggers a real settled Hedera testnet transaction, confirmed
on the Mirror Node.

Persistence is a plain in-memory `Map` for now (`responseStore.ts`) —
explicitly a placeholder, not a design decision. It gets replaced by
`packages/db` once the dashboard (Day 4) or duplicate-detection (Day 3 LLM
work) actually need it to survive a restart or be queryable.

Still stubbed: the LLM judgment itself (`resource-server/src/verify.ts`
always approves), the Apps Script side hasn't been pointed at a real
deployed orchestrator URL yet, and there's no claim email / HCS anchoring /
Privy / World ID yet.

## 2026-09-09 — Privy wallet provisioning + Hedera payout, proven end to end

Journey B's core mechanic ("money lands via a Privy-provisioned embedded
wallet tied to her email... never sees a seed phrase") is real, not just
described. Key finding: **Privy has no native Hedera chain type** — it only
issues `ethereum` / `solana` / etc. wallets. But Hedera accounts use the
same secp256k1 curve as Ethereum, and Hedera supports auto-account-creation
from an EVM address alias (HIP-583): sending HBAR to a `0x...` address
that's never touched Hedera creates a "hollow" account for it automatically,
which can only *receive* funds until it signs its own first outbound
transaction. So a Privy `ethereum`-type embedded wallet's address is a
directly usable Hedera payout destination — no bridging, no extra key
material to manage.

`services/orchestrator/src/privy.ts` provisions (or looks up, idempotently
via a hashed-email `external_id`) a Privy wallet server-side — no wallet UI
ever shown, matching the "she never creates a wallet manually" requirement
literally, not just in spirit. `hederaPayout.ts` sends HBAR to that
wallet's address via `AccountId.fromEvmAddress()` (from the same
`@hiero-ledger/sdk` re-exported by `@x402/hedera` — no new Hedera dependency
needed).

Every respondent wallet gets a Privy **policy** attached at creation
(`privySetupPolicy.ts`, run once, id in `.env`) that denies every wallet
method by default (`method: "*"`, `action: "DENY"`, empty conditions —
accepted by the API on the first try). This is the explicit "must use at
least one Privy control" requirement for the B2B/financial-flow tracks,
and it's substantive, not decorative: these wallets are provisioned with
nobody present to authorize a spend, so locking them to receive-only is the
actually-correct security posture, not just a box to check.

Also note: `@privy-io/server-auth` is deprecated in favor of `@privy-io/node`
— worth knowing since a lot of older Privy docs/examples still reference the
old package. The importable client class is `PrivyClient` (not `PrivyAPI`,
which is the lower-level generated client `PrivyClient` wraps), constructed
with `{ appId, appSecret }` (camelCase `appId`), and its resource groups are
accessed as methods — `.wallets()`, `.policies()` — not properties.

Verified live: `pnpm privy:spike` provisioned a wallet
(`0xc24034467b7986d5daf89257911d1965020f422c`) and paid it 0.001 HBAR.
Confirmed independently on the Mirror Node — the payout transaction is a
real `CRYPTOCREATEACCOUNT`, and the address now resolves to Hedera account
`0.0.10441626` with a balance of exactly 100,000 tinybars and no key set
(the "hollow" state HIP-583 describes).

Not yet wired: this is still a standalone spike, not called from the real
claim flow (which doesn't exist yet — no claim email, no World ID gate, no
`apps/web` claim page).

## 2026-09-09 — apps/web scaffolded: creator console (Journey A)

Next.js app, single page for now: Privy login (creates a real embedded
wallet for the creator — literal "create at least one wallet" requirement,
not just a login button), set price-per-response/max-responses, fund the
pot, live polling dashboard.

**Funding model, and why:** the creator's Privy wallet doesn't itself sign
a Hedera transfer to fund the pot. Privy has no native Hedera signer, and
building raw-transaction signing through Privy's generic sign API (construct
the Hedera protobuf transaction, send its bytes to Privy for a raw secp256k1
signature, reassemble and submit) is a real, solvable engineering task but a
meaningfully bigger one than the time available justified this pass. Instead:
the treasury is orchestrator's own Hedera operator account (the same one
already used for x402 and payouts), the creator sends testnet HBAR to it
however they already can (their own testnet account), and pastes the
resulting transaction id — which the backend checks against the public
Mirror Node before marking the form funded (`hederaMirror.ts`,
`verifyIncomingHbarTransfer`). This keeps "funded and locked" a checkable
fact, not a promise, without requiring Privy-signed Hedera transactions.
Revisit if there's time: routing real fund custody through a Privy-signed
transfer would be a stronger B2B-track story.

**Bug found by testing, not assumed away:** the first version of
`verifyIncomingHbarTransfer` only checked `transactions[0]` from the Mirror
Node response. Tested against a real transaction from the Privy payout
spike and it failed — turns out a single transaction id can resolve to
*multiple* records (the real `CRYPTOTRANSFER` at nonce 0, plus a
synthesized `CRYPTOCREATEACCOUNT` fee record at nonce 1 when the recipient
is a fresh hollow account), and index `[0]` happened to be the wrong one.
Fixed to check every record in the response; re-tested against the same
real transaction (true) plus two deliberately-wrong cases (amount too
high, wrong recipient — both correctly false).

## Why two backend services instead of one

The Hedera track requires: "Host a live x402-gated service... Build a
platform or agent that consumes that service and completes at least one real
paid request end to end." Keeping the resource server and the paying client
as separate deployable services (even if they can run on one host during the
hackathon) makes this requirement unambiguous in the README, the architecture
diagram, and the demo video — there is a clearly-servable "service" and a
clearly-distinct "agent/platform" paying for it, not one process pretending
to be both.
