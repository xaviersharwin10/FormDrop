# FormDrop

A Google Forms add-on that pays respondents the instant they submit a valid response.

## The idea

The form creator funds a payout pot. An AI agent judges each response for genuine effort — not gibberish, not a duplicate, not obviously low-effort — before releasing payment. Approved respondents get paid in seconds, settled on Hedera, without ever seeing a wallet, a seed phrase, or the word "crypto."

## The problem

Researchers, brands, and NGOs running surveys or forms with cash incentives face a broken payout process today: collect PayPal emails, discover PayPal doesn't work in half the target countries, fall back to gift cards, chase people over email for weeks. Respondents in many countries can't be paid at all through traditional rails for small, one-off amounts.

The second problem is fraud: paying everyone who submits invites bots, copy-paste garbage, and duplicate submissions. Instant payout is only safe if something real is judging quality first.

## Why this needs Web3

- **Sub-dollar payments to strangers with no shared account, globally, instantly.** Card rails can't do this — fees alone would exceed the payout for many amounts, and many countries have no common payment app.
- **Verifiable, pre-funded escrow.** A respondent can see "this form is funded and locked" before spending time on it — a checkable fact, not the creator's promise.
- **Instant settlement at near-zero cost per transaction.**
- **Proof of unique humanity**, so one person can't submit fifty times to drain the pot — the structural weakness that makes instant payout risky without it.

## Two user journeys

**The creator** builds a Google Form as normal, installs the add-on, sets a price per response and a max response count, funds the pot, and shares the form link exactly as they always would. A live dashboard shows responses received, approved and paid, rejected, and remaining budget.

**The respondent** opens the form link, sees the form is funded and locked, fills it out normally, and submits. Within seconds an AI agent scores the response for genuine effort. If approved, an email arrives with a claim link: a one-time biometric uniqueness check, then the money lands in a wallet provisioned automatically and tied to their email. No wallet setup, no seed phrase, no crypto jargon required.

## Architecture, in two loops

**Loop 1 — Response → verification → proof.** The form's submit trigger posts the response to a backend. An AI agent judges it: genuine and considered, or spam/gibberish/duplicate/likely-bot? The verification call itself is a paid service, metered per call and settled on Hedera testnet — the agent doesn't just make a judgment, it's a real economic actor paying for the compute behind that judgment.

**Loop 2 — Approval → identity → payout.** An approved response triggers a claim email. The respondent completes a one-time biometric uniqueness check — the control that makes instant payout safe rather than a fraud vector, since it's what stops one person draining the pot under many fake identities. On success, a wallet is provisioned (or looked up) for their email with no wallet UI ever shown, and payment settles on Hedera. The creator's dashboard updates in real time.

## Distribution reality

A real Google Workspace Marketplace listing requires Google's review process (weeks) and isn't happening within a hackathon timeline. Instead of a script a creator has to install per form, the console has a **Connect Google Forms** button: one OAuth consent, then any form is a one-click **Enable instant notifications** away — no script editor, no code, delivered via the Forms API's push-notification watches over Cloud Pub/Sub. The respondent side is, as ever, fully public: anyone with the form link can fill it out and get paid for real, no install needed on their end. A Workspace Marketplace listing remains the natural next step post-hackathon, surfacing this directly from a form's own Extensions menu instead of a separate console.

## What makes the AI judgment real, not decorative

Given a submitted response, the agent decides approve or reject for payout based on: is this a genuine, considered answer; does it look like a duplicate or near-duplicate of a prior response to the same form; does it read as obviously LLM-generated boilerplate where personal reflection was asked for; and, when available, whether the response time is suspiciously fast for the amount of content given. This runs as a real model call with a real prompt and logged reasoning — see `specs/DECISIONS.md` for how it was built and proven against live traffic.

---

See `specs/DECISIONS.md` for the planning log, architectural decisions, and how each integration was verified end to end.
