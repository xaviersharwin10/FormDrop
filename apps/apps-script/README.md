# apps-script

Container-bound Google Apps Script installed on the demo form. Ships this way
for the hackathon (see the root README's "Distribution reality" note) rather
than as a Workspace Marketplace add-on.

## One-time setup

1. Create the demo Google Form.
2. In the form's "..." menu, open **Script editor** — this creates a
   container-bound Apps Script project.
3. Install [`clasp`](https://github.com/google/clasp) locally and run
   `clasp login`, then `clasp clone <scriptId>` in this directory (or
   `clasp push` if starting from this repo's files — check which direction
   you're syncing before running either).
4. In the Apps Script editor: **Project Settings > Script Properties**, add
   `ORCHESTRATOR_WEBHOOK_URL` pointing at the deployed orchestrator's
   `/webhook/form-submit` endpoint (or run `setWebhookUrl("...")` once from
   the editor's function picker).
5. In the form settings, enable **Collect email addresses** — this is how we
   get the respondent's identity without a redundant custom field.
6. Run `installTrigger` once from the Apps Script editor (Run button) to
   register the installable `onFormSubmit` trigger. Authorize the requested
   scopes when prompted.

## Files

- `Code.js` — the trigger installer and the `onFormSubmit` handler.
- `appsscript.json` — manifest (V8 runtime, required OAuth scopes).
