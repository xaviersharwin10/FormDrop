World ID / Selfie Check feedback — FormDrop (ETHOnline 2026)

I integrated Selfie Check as the "prove you're a real, unique human before
you get paid" gate on a Google Forms payout tool. Below is what actually
happened while building it, not a polished pitch. Writing this right after
finishing the integration so it's fresh.

Docs / integration flow

The documented request pattern (sign an RP context server-side, hand it to
the client, forward the resulting proof to v4/verify) is followable and I
didn't have to guess at the protocol shape — that part's genuinely fine.
Two things did trip me up though:

There are two packages that both export `signRequest` —
`@worldcoin/idkit-server` and `@worldcoin/idkit-core` — and nothing in the
docs I read made it obvious which one a plain Node backend should use.
`idkit-core` drags in the full client-capable bundle (WASM and all), which
is dead weight on a server that never renders anything. I only figured out
the split by going and reading the actual installed `.d.ts` files instead
of trusting the docs page. Would've saved me twenty minutes if the docs
just said "backend-only? use idkit-server."

Second, `allow_legacy_proofs: true` is a required field (not optional in
the type) on `IDKitRequestConfig`, even when you're using the
`selfieCheckLegacy` preset. If the preset name already says "legacy," I
expected that flag to be implied, not something I have to also set myself.
Small thing, but it made me stop and double check I wasn't missing a step,
since it reads like a redundant declaration.

Developer Portal

Creating the app and grabbing `app_id` / `rp_id` / `signing_key` was
straightforward, no complaints there. The real friction was this: Selfie
Check needs a feature flag turned on for your app, and that's not something
you can self-serve from the dashboard — you have to go find a World contact
and ask them to flip it, even just for sandbox testing. Nothing in the
portal UI told me this flag existed or that I needed it. I found out by
trying a real Selfie Check, having it silently not work the way I expected,
and asking around. If there's a way to see "this app is missing the Selfie
Check flag" directly in the dashboard, I never found it — and that was the
single biggest time sink in the whole integration, more than any code
issue.

Sandbox app / test flow

Once the flag was on, the actual device flow worked well — installed the
sandbox app on an Android phone, scanned the QR code from the claim page on
a desktop browser, completed a real Selfie Check, got a valid proof back.
No complaints about the scan flow itself.

One thing worth mentioning: before the flag was enabled, I could still
partially test my own plumbing by sending a deliberately invalid proof and
confirming it round-tripped to the real v4/verify endpoint and got rejected
correctly. That was actually useful — it let me prove my RP signing and
verify-call wiring were correct independent of whether Selfie Check access
was live yet, so at least I wasn't fully blocked while waiting on the flag.
I'd call that out as something that worked well, not just complaints.

What I couldn't easily test: reusing the same nullifier from a second
identity (my anti-abuse check — one payout per person per form). There's no
obvious way in the sandbox to simulate "a different real person" without an
actual second device and a second real face, so I ended up verifying that
path with unit tests against captured Mirror Node data instead of the
sandbox app. If there's a sandbox mechanism for generating multiple
distinct test identities without needing multiple physical humans, it
wasn't discoverable to me.

What was actually broken/confusing

This is the one I'd flag as an actual bug, not a docs gap. When my own
backend rejected a claim for an unrelated reason (a 404, because the form
hadn't been registered on my side yet — nothing to do with the proof
itself), IDKit's widget caught that rejection and showed the user its own
generic message: "Verification declined — Failed to verify your credential
proof. Please contact the website owner." That's misleading. The proof
itself was already valid by that point — my own server-side code failed
*after* verification succeeded, for a completely separate reason. But the
UI text tells the user (and tells me, the first time I saw it) that Selfie
Check itself failed. That cost me real debugging time, because I went and
re-checked my World ID plumbing before I realized the actual bug was
somewhere else entirely. I'd really like `handleVerify` failures to be
distinguishable in the UI from actual proof-verification failures — right
now they look identical to the end user and to the developer watching the
screen.

Net take: once the sandbox flag was on, the actual verification mechanics
were solid and did exactly what the docs said they'd do. The two things
I'd change are making the sandbox feature-flag requirement discoverable
without having to ask a human, and not collapsing "your app's backend threw
an error" and "the proof was invalid" into the same error message.
