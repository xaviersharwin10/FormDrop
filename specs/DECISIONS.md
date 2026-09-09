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

Priority #1 from the build plan is done. `pnpm --filter @paid-forms/orchestrator spike`
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

## Why two backend services instead of one

The Hedera track requires: "Host a live x402-gated service... Build a
platform or agent that consumes that service and completes at least one real
paid request end to end." Keeping the resource server and the paying client
as separate deployable services (even if they can run on one host during the
hackathon) makes this requirement unambiguous in the README, the architecture
diagram, and the demo video — there is a clearly-servable "service" and a
clearly-distinct "agent/platform" paying for it, not one process pretending
to be both.
