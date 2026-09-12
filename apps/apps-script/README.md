# apps-script

A **standalone** Google Apps Script project — not bound to any one Google
Form — that can watch as many forms as you list in a script property.
Adding a new form never means creating a new script or copy-pasting code:
you add its id to a list and run one function.

(An earlier version of this was container-bound, one script per form. See
`specs/DECISIONS.md` for why that was replaced — Apps Script triggers are
always scoped to one resource, so *some* per-form step is unavoidable, but
it doesn't have to be "own a whole script project per form.")

## One-time setup

1. Go to [script.google.com](https://script.google.com) → **New project**.
   This is intentionally *not* created from inside a Form's Extensions
   menu — that's what makes it container-bound. Rename the project
   (e.g. "FormDrop watcher").
2. Replace the default `Code.gs` contents with this directory's `Code.js`.
3. Open `appsscript.json` in the project (**Project Settings** → check
   "Show appsscript.json manifest file in editor") and replace it with
   this directory's `appsscript.json`.
4. **Project Settings → Script Properties**, add:
   - `ORCHESTRATOR_WEBHOOK_URL` = `https://formdrop-orchestrator.onrender.com/webhook/form-submit`
     (the same URL for every form — the orchestrator tells forms apart by
     the `formId` in each payload, not by the URL)
   - `FORM_IDS` = the edit-id of your first form (see below for where to
     find it)
5. In the function picker (top toolbar), select `syncFormTriggers`, click
   **Run**, and authorize the requested scopes when prompted. Check
   **Executions** (left sidebar) to confirm it logged
   `Registered: <id> (<title>)`.
6. In each form's settings, enable **Collect email addresses** — this is
   how we get the respondent's identity without a redundant custom field.

## Adding another form later

1. Find the form's **edit-id** — the segment in
   `docs.google.com/forms/d/<THIS PART>/edit`. Not the `.../forms/d/e/<id>/viewform`
   public link; that's a different id for the same form.
2. **Project Settings → Script Properties** → edit `FORM_IDS`, append
   `,<the new id>`.
3. Run `syncFormTriggers` once (function picker → Run). Already-registered
   forms are skipped, so this is always safe to re-run.

Run `listRegisteredForms` any time to see every form this project is
currently watching, straight from the installed triggers — not just what
`FORM_IDS` says, in case the two ever drift.

## Files

- `Code.js` — `syncFormTriggers` / `listRegisteredForms` (registration) and
  the shared `onFormSubmitInstallable` handler that fires for every
  registered form.
- `appsscript.json` — manifest (V8 runtime, `forms` scope — not
  `forms.currentonly`, since this script isn't bound to one form).
