/**
 * Standalone Apps Script — not bound to any single Google Form.
 *
 * One project, one webhook URL, watching as many forms as you list in the
 * FORM_IDS script property. Adding a new form never means copying this
 * script again: append the form's id to FORM_IDS (Project Settings >
 * Script Properties) and run syncFormTriggers() once.
 *
 * Uses FormApp.openById() + the "forms" (not "forms.currentonly") OAuth
 * scope, since a standalone script has no "active form" of its own — see
 * appsscript.json.
 */

/**
 * Reads FORM_IDS and installs an onFormSubmit trigger for any form in the
 * list that doesn't already have one. Safe to re-run any time — already
 * registered forms are skipped, not duplicated.
 */
function syncFormTriggers() {
  const formIds = getFormIds_();
  if (formIds.length === 0) {
    Logger.log("FORM_IDS script property is empty — nothing to register.");
    return;
  }

  const registered = new Set(
    ScriptApp.getProjectTriggers()
      .filter((t) => t.getHandlerFunction() === "onFormSubmitInstallable")
      .map((t) => t.getTriggerSourceId()),
  );

  formIds.forEach((formId) => {
    if (registered.has(formId)) {
      Logger.log("Already watching: " + formId);
      return;
    }
    const form = FormApp.openById(formId);
    ScriptApp.newTrigger("onFormSubmitInstallable").forForm(form).onFormSubmit().create();
    Logger.log("Registered: " + formId + " (" + form.getTitle() + ")");
  });
}

/** Prints every form this script currently has a submit trigger on. */
function listRegisteredForms() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "onFormSubmitInstallable")
    .forEach((t) => Logger.log(t.getTriggerSourceId()));
}

/**
 * Fires on every submission to any registered form. The form itself comes
 * from e.source (not FormApp.getActiveForm(), which only works for
 * container-bound scripts) — that's what lets one project safely handle
 * submissions from multiple different forms.
 *
 * @param {GoogleAppsScript.Events.FormsOnFormSubmit} e
 */
function onFormSubmitInstallable(e) {
  const webhookUrl = getWebhookUrl_();
  if (!webhookUrl) {
    Logger.log("ORCHESTRATOR_WEBHOOK_URL not set in Script Properties — skipping.");
    return;
  }

  const form = e.source;
  const response = e.response;

  const answers = {};
  response.getItemResponses().forEach((itemResponse) => {
    answers[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
  });

  const payload = {
    formId: form.getId(),
    responseId: response.getId(),
    respondentEmail: response.getRespondentEmail(),
    submittedAtIso: response.getTimestamp().toISOString(),
    answers: answers,
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const result = UrlFetchApp.fetch(webhookUrl, options);
  Logger.log("Webhook responded with status " + result.getResponseCode());
}

function getFormIds_() {
  const raw = PropertiesService.getScriptProperties().getProperty("FORM_IDS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function getWebhookUrl_() {
  return PropertiesService.getScriptProperties().getProperty("ORCHESTRATOR_WEBHOOK_URL");
}

function setWebhookUrl(url) {
  PropertiesService.getScriptProperties().setProperty("ORCHESTRATOR_WEBHOOK_URL", url);
}

/** Adds one form id to FORM_IDS and registers it in one call. */
function addForm(formId) {
  const existing = getFormIds_();
  if (!existing.includes(formId)) {
    existing.push(formId);
    PropertiesService.getScriptProperties().setProperty("FORM_IDS", existing.join(","));
  }
  syncFormTriggers();
}
