# World ID / Selfie Check feedback — FormDrop (ETHOnline 2026)

Selfie Check is the "prove you're a real, unique human before you get paid" gate on a Google Forms payout tool. Notes below are from actually building it — written right after finishing the integration, not polished after the fact.

## Docs & integration flow

- The core request pattern (sign an RP context server-side, hand it to the client, forward the resulting proof to `v4/verify`) is followable as documented — didn't have to guess at the protocol shape.
- **Confusing:** both `@worldcoin/idkit-server` and `@worldcoin/idkit-core` export `signRequest`, and nothing in the docs made it obvious which one a plain Node backend should use. `idkit-core` pulls in the full client-capable bundle (WASM and all) — dead weight on a server that never renders anything. Only found the split by reading the installed `.d.ts` files directly. A one-line "backend-only? use `idkit-server`" in the docs would've saved ~20 minutes.
- **Minor:** `allow_legacy_proofs: true` is a required (non-optional) field on `IDKitRequestConfig` even when using the `selfieCheckLegacy` preset. Expected the preset name to imply it — reads as a redundant declaration, made me stop and double-check I wasn't missing a step.

## Developer Portal

- Creating the app and grabbing `app_id` / `rp_id` / `signing_key` — straightforward, no complaints.
- **Biggest time sink in the whole integration:** Selfie Check needs a feature flag enabled on your app, and it's not self-serve from the dashboard — you have to find a World contact and ask them to flip it, even for sandbox testing. Nothing in the portal UI surfaces that this flag exists or is missing. Found out only by trying a real Selfie Check, having it silently not work, and asking around.

## Sandbox / test flow

- Once the flag was on: installed the sandbox app on Android, scanned the QR from the claim page, completed a real Selfie Check, got a valid proof back. Clean, no complaints about the scan flow itself.
- **Worked well:** even before the flag was enabled, could still test plumbing end-to-end by sending a deliberately invalid proof to the real `v4/verify` endpoint and confirming it round-tripped and got rejected correctly. Proved RP signing + verify-call wiring were correct independent of whether Selfie Check access was live — wasn't fully blocked while waiting on the flag.
- **Gap:** no discoverable sandbox mechanism for simulating a second distinct identity, to test our own anti-abuse check (one payout per real human per form — the nullifier-reuse path). Ended up testing that logic against captured Mirror Node data instead of the sandbox app, since it needs an actual second device + second real face otherwise.

## The one actual bug (not a docs gap)

- Our creator dashboard had registered a form under its public **viewform** id, while the claim link's backend lookup used the form's **edit** id — two different ids for the same Google Form. So when a respondent claimed, our backend looked up an id it didn't recognize and returned 404 — a bug entirely on our side, and it happened *after* the World ID proof itself had already verified successfully.
- IDKit's widget caught that downstream rejection and showed its own generic message: **"Verification declined — Failed to verify your credential proof. Please contact the website owner."** — identical to what a real invalid-proof rejection looks like.
- This cost real debugging time: re-checked our RP signing and verify-call wiring first, before realizing the actual failure was downstream of a *successful* verification, in our own code.
- **Ask:** make `handleVerify`-thrown errors distinguishable, in the UI, from actual proof-verification failures. Right now they're identical to both the end user and the developer watching the screen.

## Net take

Once the sandbox flag was on, the actual verification mechanics were solid and did exactly what the docs said. Two changes would help most: make the sandbox feature-flag requirement discoverable without asking a human, and stop collapsing "your app's backend threw an error" and "the proof was invalid" into the same error message.
