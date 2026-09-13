# Setup

Step-by-step instructions to run FormDrop's three services locally and
replicate every integration. For the pitch, architecture, and proof links,
see [`README.md`](README.md). For the full reasoning behind each decision
and every empirical finding, see [`specs/DECISIONS.md`](specs/DECISIONS.md).

Requires **Node.js 20+** and **pnpm**.

```
git clone <this repo>
cd ethOnline-2026
pnpm install
```

Three services, three `.env` files:

- `services/resource-server/.env` (copy from `.env.example`)
- `services/orchestrator/.env` (copy from `.env.example`)
- `apps/web/.env.local` (copy from `.env.local.example`)

---

## 1. Hedera testnet account

1. Create a free testnet account at [portal.hedera.com](https://portal.hedera.com) — instant, includes test HBAR.
2. Grab the **ECDSA** private key, not ED25519 (`@x402/hedera` requires `PrivateKey.fromStringECDSA`).
3. Set in `services/resource-server/.env`: `HEDERA_PAY_TO_ACCOUNT_ID` — the account that *receives* verification payments (public ID only, no key needed here).
4. Set in `services/orchestrator/.env`: `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` — the account that *pays* for verification calls and operates everything else (escrow deploy, payouts, HCS).

## 2. Gemini (AI verification judge)

1. Grab a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — no billing needed.
2. Set `GEMINI_API_KEY` in `services/resource-server/.env`.

## 3. Blocky402 (x402 facilitator)

No signup needed — the facilitator (`https://api.testnet.blocky402.com`) is open access. Already the default in `.env.example`.

- Settlement asset defaults to **testnet USDC** (`X402_SETTLEMENT_ASSET=USDC`). Switchable to native HBAR with the same env var.
- If using USDC, the pay-to account needs a one-time token association: `pnpm --filter @formdrop/orchestrator hedera:setup-usdc-pay-to-account` (generates a fresh account, associates it, discards the private key immediately).

## 4. Postgres (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. Grab the connection string from **Project Settings → Database → Connection pooling** (Supavisor) — not the direct connection string (IPv6-only, unreachable from many hosts).
3. Set `DATABASE_URL` in `services/orchestrator/.env`.
4. Apply the schema: `pnpm --filter @formdrop/orchestrator db:migrate` (idempotent, safe to re-run).

## 5. Privy (wallets)

1. Create an app at [privy.io](https://privy.io) — free tier. Grab the App ID and App Secret.
2. Set `PRIVY_APP_ID` / `PRIVY_APP_SECRET` in `services/orchestrator/.env`.
3. Respondent payout wallets: `pnpm --filter @formdrop/orchestrator privy:setup-policy` — creates the receive-only policy, prints `PRIVY_RESPONDENT_POLICY_ID` to add to `.env`.
4. Creator pot-funding wallet: `pnpm --filter @formdrop/orchestrator privy:setup-creator-authorization-key` — creates the key-quorum authorization key, prints `PRIVY_CREATOR_KEY_QUORUM_ID` / `PRIVY_CREATOR_AUTHORIZATION_PRIVATE_KEY` to add to `.env`.
5. In `apps/web/.env.local`, set `NEXT_PUBLIC_PRIVY_APP_ID` to the same App ID (client-safe — never put the App Secret in `apps/web`).

## 6. World ID (Selfie Check)

1. Create an app at [developer.world.org](https://developer.world.org) — grab `app_id`, `rp_id`, and `signing_key`.
2. Selfie Check needs an extra feature flag enabled by a World rep, even for sandbox — request it before expecting a real claim to succeed.
3. Set `WORLD_APP_ID` / `WORLD_RP_ID` / `WORLD_SIGNING_KEY` in `services/orchestrator/.env` (`WORLD_ENVIRONMENT=sandbox` while access is pending).

## 7. HCS audit trail

1. `pnpm --filter @formdrop/orchestrator hcs:setup-topic` — creates the public topic, prints `HCS_AUDIT_TOPIC_ID` to add to `.env`.

## 8. On-chain escrow contract

1. `pnpm --filter @formdrop/orchestrator hedera:deploy-escrow` — compiles `contracts/FormDropEscrow.sol` (via the `solc` npm package, no Hardhat/Foundry) and deploys it, printing `ESCROW_CONTRACT_ID` to add to `.env`.

## 9. Claim emails (Gmail API via OAuth)

1. In a Google Cloud project, enable the **Gmail API**.
2. Create an OAuth 2.0 Client ID, type **Desktop app** (APIs & Services → Credentials).
3. Set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GMAIL_SENDER_EMAIL` (the sending account's own address) in `services/orchestrator/.env`.
4. If the sending account isn't a verified tester on this client's consent screen yet, add it there first — this client only ever needs one sender, so it can stay in Testing mode.
5. `pnpm --filter @formdrop/orchestrator gmail:setup-oauth` — runs Google's local loopback OAuth flow once, prints `GOOGLE_OAUTH_REFRESH_TOKEN` to add to `.env`.
6. Optionally set `WEB_APP_URL` (defaults to `http://localhost:3000`) — the claim link points here.

## 10. Google Forms push notifications (connect any form, zero install)

This is the multi-step one — a **separate** OAuth client from #9, since this one is authorized live by each creator from their browser, not a one-time local script.

1. In the same Cloud project, enable the **Google Forms API** and **Cloud Pub/Sub API**.
2. Create a Pub/Sub topic.
3. Grant **Pub/Sub Publisher** on that topic to Google's own Forms service account: `forms-notifications@system.gserviceaccount.com`.
4. Create a new OAuth 2.0 Client ID, type **Web application**, with authorized redirect URI `<orchestrator-url>/auth/google/callback`. Requested scopes: `forms.responses.readonly` + `forms.body.readonly` (two separate scopes) + `userinfo.email`.
5. Publish that OAuth client's consent screen to **In production** (fill in app name, support email, homepage URL, privacy policy URL first — required before the "Publish App" control appears). Unverified is fine for these scopes; it's a click-through warning, not a block or a 100-user cap.
6. Create a Pub/Sub **push subscription** on the topic, targeting `<orchestrator-url>/webhooks/forms-push`, with OIDC authentication enabled via a dedicated service account (e.g. `pubsub-push-invoker`).
7. Grant that service account's own **Service Account Token Creator** role to Google's Pub/Sub service agent (`service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com`) — a separate grant from step 3.
8. Set `GOOGLE_FORMS_OAUTH_CLIENT_ID` / `GOOGLE_FORMS_OAUTH_CLIENT_SECRET` / `GOOGLE_PUBSUB_TOPIC` / `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PUBSUB_PUSH_AUDIENCE` in `services/orchestrator/.env`.
9. In `apps/web/.env.local`, set `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` to the same client ID (not secret).

## 11. Google Picker (pick a form from Drive)

1. In the same Cloud project, enable the **Google Picker API** (separate from Forms/Drive above).
2. On the **same** OAuth client from #10, add this app's URL to **Authorized JavaScript origins** (e.g. `http://localhost:3000` for local dev).
3. Create an **API key** (Credentials → Create credentials → API key). Restrict it (Websites) to this app's origin **and** `https://docs.google.com/*` — the Picker renders inside a `docs.google.com` iframe, and omitting that origin breaks every picker call.
4. In `apps/web/.env.local`, set `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` and `NEXT_PUBLIC_GOOGLE_PICKER_APP_ID` (the Cloud project's numeric **project number**, not the project ID string).

---

## Running it

```
pnpm dev:resource-server   # :4001
pnpm dev:orchestrator      # :4002
pnpm dev:web               # :3000
```

Log in to the console at `localhost:3000` (creates your creator embedded
wallet), connect a Google account, pick a form, set a price, fund the pot,
and enable instant notifications.

## Deploying (Render)

All three services deploy from one [`render.yaml`](render.yaml) blueprint:
connect this repo at [render.com](https://render.com) (New → Blueprint).
Public identifiers are already inlined in the committed file; every real
secret is marked `sync: false` so Render prompts for it in the dashboard
instead of it ever living in git.
