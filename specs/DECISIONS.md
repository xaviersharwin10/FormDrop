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

Working name in initial planning was "Paid Forms" — literal but not
distinctive. Renamed to **FormDrop** (forms + an instant payout "drop"):
short, one word, easy to say in a 2-4 minute demo video, doesn't require
explaining what it means. Package scope (`@formdrop/*`), README, and repo
all use the new name.

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

## 2026-09-09 — World ID Selfie Check wired into the claim flow

Loop 2 is now complete end to end in code: approved response -> claim page
-> Selfie Check -> Privy wallet -> Hedera payout. Full flow, verified
against real APIs where testable without a physical device walkthrough
(details below).

**Package split, confirmed from actual installed types, not docs alone:**
`@worldcoin/idkit-server` (pure Node, no WASM/browser bundle) holds
`signRequest` for RP-signing on the backend; `@worldcoin/idkit-core`
re-exports the same function but pulls in the full client-capable bundle —
unnecessary weight for orchestrator, so orchestrator depends on
`idkit-server` directly and only `apps/web` depends on the full `idkit`
React package.

**The full request flow**, matching World's documented 9-step pattern:
orchestrator signs an RP context server-side (`signing key` never reaches
the browser) -> claim page requests that signature -> `IDKitRequestWidget`
(preset `selfieCheckLegacy`, `allow_legacy_proofs: true` — required even
though the preset name implies it's handled; verified against the actual
`IDKitRequestConfig` type, which has no `?` on that field) opens for the
respondent -> on success, the proof is forwarded to orchestrator ->
orchestrator forwards it *as-is* to World's real `v4/verify` endpoint ->
only on a valid response does the nullifier get checked for reuse and the
payout fire.

**Nullifier scope is per-form, not global**
(`formdrop-claim-<formId>`): a verified human can claim from many
different forms over time, just not drain the same pot twice by
resubmitting under fake emails. This matches the brief's actual threat
model (protect *this* pot) rather than a stricter "one payout ever across
the whole platform" reading, which would be wrong for a real product.

**What's verified live vs. what still needs a physical device:**
- Verified: RP-signature generation (pure local ECDSA signing, no network).
- Verified: a claim attempt with a deliberately invalid World ID proof
  round-trips to World's *real* `v4/verify` endpoint and is correctly
  rejected (422) — proves `rp_id` and the whole plumbing are wired
  correctly, independent of whether Selfie Check itself is enabled yet.
- Not verified (can't be, from here): a real successful Selfie Check
  completion. That needs the feature flag enabled for this app by a World
  rep, the sandbox app on a real Android device, and someone physically
  clicking through the flow — none of which is possible from this
  environment. `WORLD_ENVIRONMENT=sandbox` is set so it's ready the moment
  access is confirmed.

## 2026-09-10 — Full Loop 2, proven live with a real human and a real device

Selfie Check is enabled for this app — confirmed by actually doing it, not
by asking World. Sharwin installed the sandbox app on an Android phone,
opened the claim page in a desktop browser, scanned the resulting QR code,
completed a real Selfie Check, and the page showed a paid wallet and
transaction id.

Independently confirmed on the Mirror Node: a real `CRYPTOTRANSFER`,
100,000 tinybars, from the orchestrator's operating account to
`0.0.10442744` — a fresh hollow account for the Privy-provisioned wallet,
no key set, exactly the receive-only state HIP-583 describes. This is the
first real (not synthetic/negative-test) pass through every piece of Loop
2 at once: World's actual verification API accepted a real proof, the
nullifier got recorded, Privy provisioned the wallet, Hedera paid it.

Also confirmed: re-attempting the claim on the same response is correctly
rejected (`"already claimed"`, the cheap guard that runs before even
touching World's API). The other guard — the same nullifier reused on a
*different* response, simulating one human resubmitting under a second
fake email — shares the identical code path and was verified earlier with
direct unit tests against real Mirror Node data, but wasn't re-exercised
with a second physical Selfie Check scan; noted honestly rather than
claimed as separately proven.

All three sponsor integrations now have a genuine, live, on-chain-verified
proof point: Hedera (x402 payment, twice), Privy (wallet provisioning +
payout), World (this). None of the three are decorative — pull any one out
and a specific attack becomes possible (pay without judging quality, pay
without a real destination, pay the same human twice).

## 2026-09-10 — Real LLM verification wired in, on Gemini's free tier

`resource-server/src/verify.ts` no longer always-approves. Explicit call:
Sharwin rejected using the Anthropic API for this ("anthropic api key gets
billed according to usage right..I wanna go with a free llm bruh") — a
reasonable cost decision for a hackathon judging pot, so verification runs
on Google's Gemini free tier instead (`@google/genai`, model
`gemini-3.6-flash`, structured JSON output via `responseSchema` derived from
the same `zod` verdict shape used everywhere else in the codebase).

**Model name drift caught immediately by testing, not assumed away:**
`gemini-2.5-flash` (what training data suggests as current) returned a hard
404 — "no longer available to new users... use models/gemini-3.6-flash."
Confirms the pattern already established in this project: verify the actual
live API response, don't trust a remembered model string.

**Duplicate detection needs cross-response context**, so the `/verify`
contract changed from taking a bare `FormSubmissionPayload` to a
`VerifyRequestBody` (`{ payload, priorAnswerTexts }`) — orchestrator now
passes up to the last 20 answers submitted to the same form so Gemini can
actually compare instead of judging each response in isolation.

**Proven live, not just typechecked**, with three deliberately distinct
cases run straight through the full pipeline (webhook -> x402 payment on
Hedera testnet -> Gemini judgment), not just the LLM in isolation:
- Gibberish + 1-2s submit time -> `REJECT`, `isGibberish: true`,
  `isSuspiciouslyFast: true`, confidence 0.98-1.0.
- A specific, realistic answer at a plausible completion time -> `APPROVE`,
  confidence 0.98, reasoning citing the actual concrete detail given.
- A near-duplicate of a prior answer (two words changed) against
  `priorAnswerTexts` -> `REJECT`, `isDuplicateOrNearDuplicate: true`,
  reasoning naming the exact phrasing overlap.

Each case settled a real, separate Hedera testnet x402 payment
(`0.0.7162784@1789002671...`, `0.0.7162784@1789002697...`) regardless of the
verdict — the orchestrator pays resource-server for the judgment call
itself; only an `APPROVE` verdict makes the respondent's payout eligible.
This is the anti-fraud gate the brief actually asked for, discriminating
for real rather than rubber-stamping every submission.

## 2026-09-10 — Claim email sent automatically on APPROVE, via Resend

The last silent gap in Loop 2 closed: previously an `APPROVE` verdict just
sat in `responseStore` with nobody told the claim link exists. Now
`webhook.ts` fires `sendClaimEmail` (fire-and-forget, `services/orchestrator/src/email.ts`)
the moment a response is recorded as `APPROVE`.

**Resend, on its shared test sender, needs no domain verification to send
to arbitrary recipients** — confirmed by testing, not assumed from a
WebFetch summary (Resend's own docs pages didn't actually state this either
way when checked). `onboarding@resend.dev` as the `from` address delivered
successfully to a real Gmail inbox with zero setup beyond an API key.
`CLAIM_EMAIL_FROM` is a config var specifically so this swaps to a verified
custom domain later without a code change.

**Deliberately fire-and-forget, not awaited into the response:** the x402
payment has already settled and the verdict is already recorded by the
time the email send is attempted — a bounced or slow email must never turn
a successful paid verification into a 5xx to the Apps Script webhook
caller. Errors are logged, not thrown.

Proven live end to end, not just as an isolated function call: a real
webhook POST with a genuine answer → real x402 settlement on Hedera
testnet (`0.0.7162784@1789004592.568918146`, confirmed on the Mirror Node)
→ real Gemini `APPROVE` → a real email landed in a Gmail inbox with a
claim link containing the correct `formId`/`responseId`.

## 2026-09-10 — HCS anchoring: verification verdicts are now a public, tamper-proof audit trail

Closes Hedera's "verifiable payment audit trails on HCS" extra-credit item.
`services/orchestrator/src/hcs.ts` submits one message per verification
call to a dedicated HCS topic — `formId`, `responseId`, a SHA-256 hash of
the response payload (not the raw payload — keeps respondent PII off a
public ledger while still letting anyone with the original payload re-hash
and confirm a match), the full verdict, and the x402 payment transaction id
that paid for the judgment call.

**Topic created with no admin/submit key, deliberately.** This is meant to
be an independently-checkable public record, not a gated one — a judge (or
anyone) can query the Mirror Node directly and decode a message without
needing any of our keys. One-time setup via `pnpm hcs:setup-topic`
(mirrors the `privy:setup-policy` pattern), topic id pasted into `.env`.

**Every response gets anchored, not just approvals** — this is an audit
trail of the verification *process* (what was judged, how, and what paid
for it), matching the track's literal "payment audit trails," since
resource-server gets paid via x402 for the judgment call regardless of
its outcome.

**Fire-and-forget, same reasoning as the claim email:** anchoring happens
after the response is already recorded and (if approved) the claim email
already queued — an HCS failure must never turn an already-settled payment
into a webhook error. The resulting `hcsTransactionId`/`hcsSequenceNumber`
get attached to the stored response asynchronously and exposed via
`GET /forms/:formId/responses/:responseId` for the demo.

Proven live, independently, not just via our own endpoint: submitted a
real webhook request, then fetched the message straight from the public
Mirror Node (`/api/v1/topics/0.0.10460886/messages/1`) and base64-decoded
it — the decoded JSON is the exact audit record, byte for byte, including
the real Gemini reasoning text and the real x402 transaction id from the
same request.

## 2026-09-10 — Card funding via Stripe: the "card or crypto in" model, both actually built

Closes a real gap flagged by testing the product end to end rather than
just the demo path: funding previously required the creator to already
hold testnet HBAR and manually send it, which is not what a real
Marketplace product could ask of a researcher/NGO with no crypto
experience. `services/orchestrator/src/stripeFunding.ts` adds a genuine
card-payment path alongside the existing crypto path — the original plan's
"funds $900 total via a simple web app (card or crypto in)" — rather than
replacing tested working code.

**Why Stripe and not Privy's own fiat onramp:** checked first, since it
would've been a cleaner single-vendor story. Privy's `useFiatOnramp`
supports Base, Solana, Ethereum, Arbitrum, Polygon, and Tempo as
destination chains — **not Hedera**. Confirmed from Privy's own docs
before writing any code, not assumed. So the card charge and the actual
settlement asset are necessarily decoupled: Stripe charges USD, and on
success our backend (already the treasury for x402 and payouts) funds the
pot in testnet HBAR. A `USD_CENTS_PER_HBAR` peg (default 100, i.e. $1/HBAR)
exists purely to give the card charge a coherent amount — testnet HBAR has
no real value, so this is explicitly nominal, not a real exchange rate.

**Fastify needs the raw request body for Stripe's signature check**, which
the default JSON body parser throws away after parsing. Fixed by
overriding the `application/json` content-type parser globally to stash
the raw `Buffer` on `request.rawBody` (typed via a `fastify.d.ts` module
augmentation) while still parsing JSON as before — every other route's
behavior is unchanged.

**Verified live, both halves, without needing deployment or the Stripe
CLI** (neither exists yet for this repo):
- A real Checkout Session, created against the live Stripe API for a
  3-HBAR pot, independently re-fetched from Stripe's own API to confirm
  `amount_total: 300` (cents) and the correct `formId`/`potTinybar`
  metadata.
- The webhook handler, exercised with a properly Stripe-signed test event
  via Stripe's own `generateTestHeaderString` helper (the officially
  supported way to test signature-verified webhook code without a live
  redirect) — correctly flipped the form to `funded: true` with
  `fundingTransactionId: "stripe:cs_test_..."`.
- A forged signature on the same endpoint was independently confirmed
  rejected (`400 invalid signature`) — the check is real, not decorative.

Not yet exercised: an actual human clicking through the real hosted
Stripe Checkout page with a test card. The session-creation and
webhook-handling halves are both proven; the middle (Stripe's own hosted
UI) is Stripe's product, not ours, so lower-risk to leave unexercised for
now.

## 2026-09-10 — Stablecoin (testnet USDC) support added to the crypto-funding path

Extends the existing "send testnet HBAR myself" funding path to also
accept testnet USDC — not every creator who already holds crypto wants to
hold volatile-priced native HBAR specifically; a stablecoin option is a
real, requested improvement, not padding.

**Hedera requires explicit token association before an account can
receive an HTS token** (unlike HBAR, which every account accepts by
default) — confirmed by checking the Mirror Node directly
(`/api/v1/accounts/<treasury>/tokens?token.id=0.0.429274` returned an empty
list before, populated after). One-time setup script
(`pnpm hedera:associate-usdc`, mirrors the `privy:setup-policy` /
`hcs:setup-topic` pattern) associates the treasury; confirmed on the
Mirror Node afterward.

**`token_transfers` shape confirmed from a real transaction, not assumed
from docs** — the Mirror Node's own Swagger/OpenAPI pages didn't render
usefully through automated fetching, so a real testnet USDC holder account
was found via `/api/v1/tokens/0.0.429274/balances`, and one of its real
transactions inspected directly: `token_transfers: [{ token_id, account,
amount, is_approval }]` — same shape as the native `transfers` array plus
a `token_id` field. `verifyIncomingTokenTransfer` (`hederaMirror.ts`)
mirrors the existing HBAR verification exactly, checking every record in
the response (same multi-record gotcha as the HBAR path) for a matching
`token_id` + recipient + amount.

**USD-cents-per-HBAR peg reused, not duplicated:** the same
`USD_CENTS_PER_HBAR` config that prices the Stripe card charge also prices
the USDC-equivalent amount owed (testnet USDC's 6 decimals mean 1 cent =
10,000 base units) — one nominal peg drives both non-native funding paths
consistently.

**Proven live, both halves:**
- The association transaction is real, confirmed on the Mirror Node
  before and after.
- `verifyIncomingTokenTransfer` was tested against a real, independent
  USDC transfer already on testnet (not one we generated — no testnet
  USDC in hand, and getting some would mean signing up for Circle's
  faucet, which wasn't done without asking first): exact match → true,
  amount too high → false, wrong recipient → false, wrong token id →
  false. The live HTTP route (`/forms/:formId/verify-funding` with
  `asset: "USDC"`) was exercised the same way and correctly returned 422
  with the exact computed minimum in the error message.
- Not yet exercised: an actual USDC transfer landing in our own treasury
  end-to-end (blocked on acquiring testnet USDC, not on our code) — noted
  honestly rather than claimed as fully proven.

## 2026-09-11 — First real Google Form pass, full loop, no simulation

Every prior proof of Loop 1 (verification) was a `curl` POST to
`/webhook/form-submit` simulating what Apps Script would send. Today a
real Google Form (created by Sharwin) was wired up for real, without
deploying anywhere yet — `cloudflared tunnel --url http://localhost:4002`
(no account needed) gave the local orchestrator a real public URL, pasted
into the Apps Script's `ORCHESTRATOR_WEBHOOK_URL` Script Property. A real
submission then drove the entire product, both loops, back to back:

form submit -> real `onFormSubmit` trigger -> real webhook over the tunnel
-> real x402 payment settled on Hedera testnet -> real Gemini `APPROVE` ->
real claim email delivered -> real World ID Selfie Check -> real Privy
wallet lookup -> real Hedera payout, shown on the claim page linked to
HashScan.

**Three real bugs surfaced, none of them hypothetical:**

1. **`ScriptApp.getProjectTriggers()` / `.newTrigger()` need the
   `script.scriptapp` OAuth scope.** Declaring any `oauthScopes` in
   `appsscript.json` switches Apps Script out of auto-detecting scopes
   from code — every scope actually used must be listed explicitly, and
   this one was missing. Fixed, and it's a good reminder that an explicit
   scope list is a completeness contract, not just documentation.
2. **Resend's shared test-mode sender only sends to the Resend account's
   own email**, not arbitrary recipients — contradicting what was
   documented after the earlier isolated test (which happened to send to
   the account owner's own address, masking the restriction). A real
   respondent using a different email got a 403 the moment it mattered.
   Switched to Gmail SMTP (`nodemailer`, App Password) — free, sends to
   any recipient immediately, no domain needed. Re-verified live to a
   third-party address before trusting it again.
3. **Claiming requires the form to be registered via `POST /forms`
   first** (for the price), which this real form never was — only the
   webhook path had been exercised for it. `processClaim` correctly
   404'd, but IDKit's widget surfaces *any* `handleVerify` rejection as
   its own generic "Verification declined... contact the website owner"
   message — genuinely misleading, since the real Selfie Check itself had
   already succeeded. Worth remembering for the demo: that error text
   does not mean World ID failed.

**Also confirmed:** `processClaim` never actually checks
`formConfig.funded` — it only needs the price. The treasury pays out
regardless, since it already holds testnet HBAR from the faucet. Funding
verification is a trust/dashboard feature for the creator, not a payout
gate — worth stating precisely, since it's easy to assume otherwise.

## Why two backend services instead of one

The Hedera track requires: "Host a live x402-gated service... Build a
platform or agent that consumes that service and completes at least one real
paid request end to end." Keeping the resource server and the paying client
as separate deployable services (even if they can run on one host during the
hackathon) makes this requirement unambiguous in the README, the architecture
diagram, and the demo video — there is a clearly-servable "service" and a
clearly-distinct "agent/platform" paying for it, not one process pretending
to be both.

## 2026-09-11 — Creator pot-funding via a Privy-signed Hedera transfer

Privy's "Best Financial Flow" track requires that "the flow itself must
execute through Privy infrastructure" — not just wallet custody somewhere in
the product. Before building anything, checked (deliberately, on request,
before writing code) whether this was a natural fit or shoehorning:

1. **Does Privy expose a signing primitive independent of chain-specific
   transaction building?** Yes — confirmed from the installed
   `@privy-io/node` `.d.ts`: `wallets()._rpc(walletId, { method:
   "secp256k1_sign", params: { hash } })` signs an arbitrary pre-computed
   32-byte hash and returns a raw signature. Not Ethereum-specific in what
   it does — it's a raw ECDSA-over-secp256k1 primitive that happens to live
   under the "ethereum" wallet type.
2. **Does Hedera's SDK support an external signer instead of a held private
   key?** Yes — confirmed from `@hiero-ledger/sdk` source:
   `Transaction.signWith(publicKey, transactionSigner)` is the *actual*
   implementation `.sign(privateKey)` itself wraps
   (`signWith(pk.publicKey, m => pk.sign(m))`), not a side door.

Both are real, general-purpose SDK features meant for exactly this kind of
"custody lives elsewhere" scenario — so this shipped as the third
pot-funding path (alongside Stripe card funding and manual crypto send),
not a replacement for the other two.

**What had to be reverse-engineered to make it work (all confirmed from
source, not assumed):**

- `Transaction.signWith`'s callback receives the **raw, unhashed** per-node
  transaction body bytes and must return a **64-byte compact (r‖s) ECDSA
  signature** — no recovery byte, straight into the protobuf `sigPair`
  (`Transaction.js` line ~1075, `PublicKey._toProtobufSignature`).
- Hedera's own ECDSA `PrivateKey.sign()` hashes that message with
  **Keccak-256** before signing
  (`@hiero-ledger/cryptography/src/primitive/ecdsa.js`) — so the bridge
  hashes with Keccak-256 itself before calling Privy, since Privy's
  `secp256k1_sign` takes an already-computed hash, not raw bytes it hashes
  for you.
- Privy **never exposes a wallet's raw public key** — only its address (a
  one-way hash of the key), but `signWith` needs an actual `PublicKey`
  object up front. Solved with one throwaway `secp256k1_sign` call and
  **ECDSA public-key recovery** (same math Ethereum uses to recover
  `msg.sender` from `v,r,s`) — try both recovery bits, keep whichever
  recovers a key whose address matches the known wallet address. Runs once
  per wallet, not per signature.
- Privy's response's TypeScript type for `_rpc` is a union over every RPC
  method's response shape (not discriminated by the request), so the
  `signature` field needs a narrowing cast — documented inline in
  `hederaPrivySigner.ts` with the exact `.d.ts` type it corresponds to.
- **The creator's new Privy wallet initially carried no Privy control at
  all**, unlike the respondent payout wallet's explicit "deny everything"
  policy (`privySetupPolicy.ts`). Checked the installed SDK's
  `PolicyMethod` enum (`@privy-io/node/resources/policies.d.ts`) before
  assuming a matching "allow only secp256k1_sign" rule could exist the same
  way — it can't: `secp256k1_sign` isn't one of the nameable methods.

  Checked whether this actually mattered for qualification before treating
  it as a blocker: it didn't — Privy's "Best B2B Financial Product"
  qualification requirement is "at least one" of policies/signers/key
  quorums/intents, and the respondent wallet's policy already satisfies
  that on its own. But since a real, better-suited mechanism existed, fixed
  it anyway rather than resting on a technicality (2026-09-11, same day):
  the creator wallet's `owner_id` is now set to a **key quorum** — one
  P-256 (secp256r1) authorization key generated and held only by our own
  server (`pnpm privy:setup-creator-authorization-key`, new file
  `privySetupCreatorAuthorizationKey.ts`; the key and quorum id are pasted
  into `.env`, never committed). Confirmed from
  `@privy-io/node/lib/authorization.d.ts` and `WalletCreateParams.owner_id`
  in the installed SDK: once a wallet has an owner, Privy requires every
  mutating request against it — including the raw `secp256k1_sign` RPC the
  funding bridge calls — to carry a `privy-authorization-signature` header
  computed with that key. Holding `PRIVY_APP_SECRET` is no longer
  sufficient on its own to make this wallet sign anything.

  `hederaPrivySigner.ts` was switched from the raw `wallets()._rpc()` call
  to the higher-level `wallets().rpc()` wrapper, which accepts an
  `authorization_context: { authorization_private_keys: [...] }` and
  computes that header itself — no hand-rolled request signing needed.

  **Proved the control is real, not decorative**, with a negative test: an
  `_rpc` call against the same wallet *without* the authorization context
  was rejected by Privy's live API with a real `401`:
  `"Missing 'privy-authorization-signature' header or no signatures
  provided."` Then confirmed the legitimate path still works end to end
  (below).
- Privy's response's TypeScript type for `_rpc`/`rpc` is a union over every
  RPC method's response shape (not discriminated by the request), so the
  `signature` field needs a narrowing cast — documented inline in
  `hederaPrivySigner.ts` with the exact `.d.ts` type it corresponds to.

**Proven end to end on real testnet Hedera**, not just typechecked, twice:
first without the key-quorum owner (created a form, provisioned a Privy
wallet `0xdd0916caA943d3883D6d038C0625FD4B082BDEb9`, sent it 1.1 real
testnet HBAR, funded the pot — real `SUCCESS` receipt
`0.0.10439799@1789137085.152790619`), then again after adding the key
quorum, against a fresh wallet `0xdDB5F014dB67a754A911b52c9C76D862D70b9717`
— real `SUCCESS` receipt `0.0.10439799@1789137988.901478637`, this time
with the authorization signature genuinely required and genuinely computed
correctly on the first attempt.

New files: `services/orchestrator/src/privyCreatorWallet.ts`,
`hederaPrivySigner.ts`, `hederaPrivyFunding.ts`,
`privySetupCreatorAuthorizationKey.ts`. New routes: `GET
/forms/:formId/privy-wallet`, `POST /forms/:formId/fund/privy-transfer`. New
deps: `@noble/hashes`, `@noble/curves` (already present transitively via
`@hiero-ledger/sdk`'s own dependency chain — pinned as direct deps instead
of relying on that).

## 2026-09-11 — x402 settlement switched to USDC (an HTS token), proven live

Full Hedera-track audit against the live prize page turned up one real,
easy bonus gap: "HTS tokens or custom fee schedules" wasn't met by the
*settlement* path — testnet USDC was only ever used for creator pot
funding. Checked `@x402/hedera`'s own source before assuming this needed
new infra: its `DEFAULT_ASSETS` table maps **both** Hedera testnet and
mainnet to USDC, not HBAR — meaning `resource-server` pricing `/verify` in
HBAR (`HBAR_ASSET_ID = "0.0.0"`) was overriding the package's own default,
not following it.

**What actually blocked it:** the existing `HEDERA_PAY_TO_ACCOUNT_ID`
(`0.0.10440038`) can't be associated with USDC without a signature from
that account's own key — a key this repo never held (by design;
resource-server's config comment says "no private key needed here; only
the paying client signs"). Rather than ask for a possibly-unrecoverable
key, a fresh account was generated instead
(`hederaSetupUsdcPayToAccount.ts`, new `pnpm hedera:setup-usdc-pay-to-account`
script): a new ECDSA keypair funds its own HIP-583 hollow account, signs
its own one-time `TokenAssociateTransaction`, and the private key is then
discarded — never printed, never stored. resource-server still never needs
to sign anything to receive payments, same as before.

**Also corrected a wrong assumption from earlier in this project:**
Circle's testnet USDC faucet does **not** require an account — checked
directly at faucet.circle.com rather than trusting the earlier note. Just a
wallet address and a captcha. 20 testnet USDC landed in the orchestrator's
operator account within minutes.

`resource-server` now prices `/verify` in USDC by default
(`X402_SETTLEMENT_ASSET=USDC`, `$0.01`/call), switchable back to HBAR via
one env var — nothing deleted, HBAR settlement is still fully proven and
still legitimate. `orchestrator`'s x402 client had its spend-control
`allowedAssets` list extended to include USDC (it was HBAR-only before,
which would have silently blocked this payment).

**Proven live, not just configured:** a real webhook submission drove a
real paid `/verify` call, and the Mirror Node shows the actual settlement
transaction — a `CRYPTOTRANSFER` with `token_id: 0.0.429274`, moving 10,000
base units ($0.01) from the orchestrator's operator account
(`0.0.10439799`) to the new pay-to account (`0.0.10478051`),
`result: SUCCESS`
(`0.0.7162784-1789139948-706832928`). Independently confirmed the
receiving account's USDC balance is exactly 10,000 base units afterward.
Verification itself ran normally end to end (Gemini `APPROVE`), proving the
whole pipeline still works with the new settlement asset, not just the
payment step in isolation.

## 2026-09-11 — Real Postgres persistence (replaces in-memory stores)

**What forced this:** live testing today surfaced multiple real bugs caused
by `orchestrator`'s three stores (`formConfigStore.ts`, `responseStore.ts`,
`nullifierStore.ts`) being plain in-memory `Map`/`Set`s. `tsx watch`
restarting on every code change during debugging wiped state mid-test more
than once — most notably, a used World ID nullifier disappeared on restart,
which looked at first like the duplicate-payout check wasn't working at
all. It was working; it just had nothing durable to check against. Same
root cause as the responses dashboard appearing empty right after a
successful claim. This was always the plan (see the original
"Database: Postgres" line in the 2026-09-09 entry above) — today's bugs
just moved it from "eventually" to "now."

**Provider:** Supabase (free tier), chosen over Neon mainly because the
Supabase dashboard was already open from the World ID Developer Portal
side of this project and the setup is functionally identical for this use
case (managed Postgres, connection string, done).

**A real, non-obvious deployment gap found and fixed:** Supabase's direct
connection hostname (`db.<ref>.supabase.co:5432`) resolves to an
**IPv6-only** address. This sandbox's Bash environment has no IPv6 egress
at all (confirmed against a known-good public IPv6 host, not just
Supabase's), so every migration attempt against the direct string timed
out — `ETIMEDOUT` at the DNS-resolved IPv6 address, never reaching
Postgres. Fixed by switching to Supabase's **Supavisor connection pooler**
string (`aws-0-<region>.pooler.supabase.com:5432`, username
`postgres.<project-ref>`), which is IPv4-reachable. Worth flagging for
Railway/Render deployment too — depending on the host's own IPv6 support,
the pooler string is the safer default regardless.

Two credential dead ends before it actually connected, both confirmed with
a raw `pg` `Client` bypassing the app entirely (not just app-level
guessing): first attempt failed `28P01 password authentication failed`
with the originally-supplied password even once URL-encoding was ruled out
as the cause (tested both as a parsed connection string and as explicit
config fields — identical failure either way). Root-caused by resetting
the database password directly in Supabase and retrying — but the reset
password *also* failed immediately after being issued, because Supavisor
takes a short window to propagate a password change; a retry ~20s later
connected cleanly. Not a code bug at any point — a credential/propagation
issue, resolved by testing at the lowest possible layer (raw TCP + raw
`pg.Client`) instead of guessing from the app's error message.

**Schema** (`services/orchestrator/src/db/schema.ts`, applied via
`pnpm db:migrate`): three tables — `forms`, `responses`,
`used_nullifiers`. The `used_nullifiers` table's composite primary key
(`nullifier`, `action`) is the actual enforcement of "one payout per real
human per form" — a real database constraint, not just an application-code
check, so it holds even under concurrent claim requests.

**Proven live, not just typechecked:** created a form via
`POST /forms`, force-killed the orchestrator process entirely (`kill -9`,
not a `tsx watch` auto-restart), started a fresh process, and queried
`GET /forms/:formId/stats` — the form was still there, byte-identical.
This is the exact failure mode that caused today's live bugs, now closed.

## 2026-09-12 — Apps Script: container-bound to standalone, multi-form

The original `apps/apps-script` (2026-09-09 decision above) was
container-bound — created from inside one specific Google Form's
Extensions menu, so its `onFormSubmit` trigger only ever fires for that
one form. With the creator dashboard now supporting multiple forms per
creator, that meant copy-pasting the whole script into a new Apps Script
project for every new form — real toil, and a ceiling on how many forms
one creator could realistically track.

Considered making it a real Google Workspace Editor Add-on instead (shows
up under Extensions automatically on every form). Checked Google's own
docs for this before committing time to it: a personally-installed test
add-on is registered against specific chosen documents in the "Test
deployments" dialog, not account-wide — so it still costs one manual step
per new form, just via a different UI, and true zero-touch account-wide
install requires Marketplace publishing, which needs a Workspace org with
admin install rights (not available here). Not worth the larger manifest
surface for the same per-form cost, days before submission.

Rebuilt instead as one **standalone** script (not bound to any form),
watching a list of form ids stored in a `FORM_IDS` script property.
`FormApp.openById()` (needs the full `forms` OAuth scope, not
`forms.currentonly`, since there's no bound "active form" to fall back
on) registers a trigger per listed id; the shared `onFormSubmitInstallable`
handler identifies which form fired via `e.source` — confirmed against
Apps Script's own trigger-event docs, not assumed — so one project safely
multiplexes across every registered form. Adding a form is now: append its
id to `FORM_IDS`, run `syncFormTriggers()` once. No new script project, no
copy-pasted code, per new form.

## 2026-09-12 — Claim emails: Gmail SMTP -> Brevo HTTP API -> Gmail REST API

First live end-to-end submission against the deployed (not local) stack
surfaced a real production bug: `sendClaimEmail failed: Error: Connection
timeout ... code: 'ETIMEDOUT', command: 'CONN'`. Payment and verdict both
worked — the failure was isolated to the SMTP connection itself.

Root cause (confirmed against Render's own changelog, not guessed from the
error alone): free Render web services block outbound traffic to SMTP
ports 25/465/587 as of 2025-09-26, specifically to cut down on spam abuse.
Gmail SMTP (nodemailer, `service: "gmail"`) always attempts port 465 —
worked in every local test, impossible to work once deployed there, no
matter how the auth is configured. This is the second time email delivery
here hit a provider-side wall: `config.ts`'s history already notes Resend
was tried first and dropped because its test-mode sender only delivers to
the Resend account's own address without a verified domain.

First replacement attempt: Brevo's HTTP API (`api.brevo.com/v3/smtp/email`,
plain HTTPS/443 — never blocked by Render). Needs only a single verified
sender address, not a verified domain, to send to any recipient — verified
against Brevo's own docs before switching, given Resend's lookalike
restriction had already cost time once. Reverted almost immediately: Brevo
flagged the brand-new account for review/suspension on signup — an
anti-fraud screening outcome outside our control and not something to
gamble on repeating with a different provider (SendGrid, Mailjet use the
same single-sender-verification model and the same fresh-account risk)
this close to submission.

Final fix: the Gmail REST API (`gmail.googleapis.com/gmail/v1/users/me/messages/send`)
instead of any third-party provider. Same benefit as Brevo — plain HTTPS,
sidesteps the SMTP port block entirely — but authenticates via OAuth2 as
an account we already own and have used for months, so there's no new
account to get flagged. One-time setup (`pnpm gmail:setup-oauth`,
`gmailSetupOAuth.ts`) runs Google's loopback OAuth flow (the current
replacement for the manual-code "out-of-band" flow Google deprecated in
2023 — confirmed before implementing, not assumed from an old tutorial)
to mint a refresh token; `email.ts` exchanges it for a short-lived access
token per send and POSTs a base64url-encoded RFC 2822 message. `nodemailer`
and `@types/nodemailer` removed from `services/orchestrator/package.json`
entirely rather than left unused.

## 2026-09-12/13 — Google Forms push notifications: a second onboarding path, alongside Apps Script

The 2026-09-12 entry above rebuilt the Apps Script watcher as one
standalone script — still real toil per new form (edit `FORM_IDS`, run a
function). For anyone viewing this project to self-serve try it — the
actual goal, not just reducing our own toil — that's still too much: it
needs the Apps Script editor, authorization, and knowing this project's
specific setup.

Real alternative, confirmed against Google's own docs before building
(not assumed): the Forms API's `watches` resource (v1beta) delivers
`RESPONSES` event notifications to a Cloud Pub/Sub topic, with zero Apps
Script involvement. A creator connects their Google account once via
normal OAuth (scope: `forms.responses.readonly` — confirmed sufficient on
its own, not the broader `drive` scope shown in Google's own sample code),
then registering a new form is one API call, no code.

**Deliberately built as an addition, not a replacement.** The existing,
proven, already-funded demo form keeps using its Apps Script trigger
untouched — nothing about its pipeline changed. This is a new, parallel
front door (`POST /webhooks/forms-push`) feeding the exact same
`handleFormSubmit` pipeline every other trigger source uses, so there's
zero duplicated business logic and zero risk to what already works.

**Real tradeoffs, weighed before committing, not glossed over:**
- Google's own docs hedge on latency ("usually within minutes," elsewhere
  "typically... a few seconds"), and there's a live Google Issue Tracker
  bug specifically titled "Push notifications are delayed." Apps Script's
  trigger is provably instant by comparison. Decided to build it anyway,
  given the explicit goal (self-serve trial by anyone) outweighs the
  Apps-Script path's latency guarantee for *this* onboarding route
  specifically — the proven, instant path stays available for the demo
  form itself.
- A `Watch` expires after 7 days and must be renewed (`POST
  /internal/renew-watches`, meant to be pinged by a scheduled job — same
  pattern as the existing keepalive crons). An unverified OAuth app's
  refresh tokens also expire after 7 days in "Testing" publishing status;
  flipping to "In production" (still unverified — full verification is a
  multi-week process) removes that cap in exchange for every connecting
  user seeing a "Google hasn't verified this app" warning they click
  through once. Chosen over staying in Testing mode specifically because
  Testing caps connections to 100 manually-added test users — the opposite
  of "anyone who views this can try it."

**New surface, kept isolated:** `googleFormsAuth.ts` (OAuth), `googleFormsApi.ts`
(the actual Forms API calls — `forms.get` for question titles,
`forms.responses.list` with a `timestamp >` filter so a notification only
pulls what's new, `watches.create`/`watches.renew`), `googleFormsPush.ts`
(verifies the Pub/Sub push's signed OIDC token via `google-auth-library`'s
`OAuth2Client.verifyIdToken` before trusting a payload — a forged POST to
a guessed public URL can't masquerade as a real notification). Two new
tables, `google_accounts` and `form_watches` — migrated onto the same live
Supabase database already backing `forms`/`responses`, confirmed present
via a direct `information_schema.tables` query, not assumed from the
migration script's exit code alone.

**A genuine reliability property, not just idempotency by luck:** the
push handler only advances a form's fetch watermark past a batch of
responses if every one of them was actually handled successfully — a
mid-batch failure (e.g. a transient payment error) leaves the watermark
where it was, so the next notification re-fetches (and safely no-ops on,
via the same `responses` table primary-key check every trigger source
already relies on) whatever already succeeded, while the failure itself
gets a real retry instead of being silently skipped forever.

## 2026-09-12 — Google Forms push notifications: real latency measured, two bugs fixed during setup

The latency question left open above ("usually within minutes" per
Google's docs, plus a live Issue Tracker bug about delayed push
notifications) is now answered empirically, not assumed: a real end-to-end
test — submit a live Google Form response, watch it land at
`POST /webhooks/forms-push` — was **instantaneous**, not "minutes." The
Apps Script path's latency advantage over this one turned out to not
exist in practice, at least at this traffic volume.

Two real bugs surfaced during first setup, both fixed before this worked:

1. **Missing OAuth scope.** `getQuestionTitles()` calls `forms.get` (the
   form's structure/questions), which needs `forms.body.readonly` —
   a separate scope from `forms.responses.readonly` (which only covers
   reading response data). Requesting only the latter produced a
   `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`. Fixed by adding
   `forms.body.readonly` to `GOOGLE_FORMS_OAUTH_SCOPE` in
   `googleFormsAuth.ts`; anyone already connected under the old scope had
   to reconnect (the OAuth flow's `prompt=consent` forces a fresh consent
   screen, and `upsertGoogleAccount`'s `ON CONFLICT (creator_id) DO
   UPDATE` overwrites the stored refresh token — no separate "disconnect"
   step needed).

2. **`v1beta` no longer exists.** `watches.create`/`watches.renew` were
   called against `forms.googleapis.com/v1beta`, matching what was
   confirmed in Google's docs when this feature was built a day earlier.
   By the time it was actually tested, `v1beta` had been fully retired —
   confirmed by fetching the API's own discovery document
   (`$discovery/rest?version=v1beta` returns 404; `version=v1` returns a
   200 with `watches` now listed under the stable `forms` resource,
   discovery revision dated 2026-09-06). Google graduated Watches out of
   beta in the days between this feature being designed and being tested.
   Fixed by pointing `googleFormsApi.ts` at `v1` for every Forms API call,
   removing the separate beta base URL entirely.

Also confirmed (not assumed) that the Pub/Sub topic already had **Pub/Sub
Publisher** granted to Google's own `forms-notifications@system.gserviceaccount.com`
— the prerequisite for Forms to be allowed to publish into the topic at
all, separate from the push-invoker service account's Service Account
Token Creator grant (that one governs delivery *to us*, this one governs
Forms' ability to publish *into the topic* in the first place).

**Decided against setting up the daily `/internal/renew-watches` cron
ping.** Watches expire 7 days after creation; the submission deadline
(2026-09-13, 9:30 PM) is under 24 hours out from when this was tested, so
no watch registered now will outlive the deadline. The renewal endpoint
stays in the code (harmless, and correct if this project has a life after
submission) but isn't wired to a scheduler.
