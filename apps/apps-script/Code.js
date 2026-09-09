/**
 * Container-bound Apps Script for the Paid Forms demo form.
 *
 * Run installTrigger() once (from the Apps Script editor, "Run" button) after
 * binding this script to a form and setting ORCHESTRATOR_WEBHOOK_URL in
 * Script Properties (Project Settings > Script Properties). This must be an
 * installable trigger, not the onFormSubmit(e) simple trigger — simple
 * triggers can't call external services, and we need UrlFetchApp here.
 */
function installTrigger() {
  const form = FormApp.getActiveForm();
  const already = ScriptApp.getProjectTriggers().some(
    (t) => t.getHandlerFunction() === "onFormSubmitInstallable" && t.getTriggerSourceId() === form.getId(),
  );
  if (already) {
    Logger.log("onFormSubmitInstallable trigger already installed.");
    return;
  }
  ScriptApp.newTrigger("onFormSubmitInstallable").forForm(form).onFormSubmit().create();
  Logger.log("Installed onFormSubmit trigger.");
}

/**
 * Fires on every form submission (installable trigger — runs as the form
 * owner, per Apps Script's model, which is what we want here).
 *
 * @param {GoogleAppsScript.Events.FormsOnFormSubmit} e
 */
function onFormSubmitInstallable(e) {
  const webhookUrl = getWebhookUrl_();
  if (!webhookUrl) {
    Logger.log("ORCHESTRATOR_WEBHOOK_URL not set in Script Properties — skipping.");
    return;
  }

  const form = FormApp.getActiveForm();
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

function getWebhookUrl_() {
  return PropertiesService.getScriptProperties().getProperty("ORCHESTRATOR_WEBHOOK_URL");
}

function setWebhookUrl(url) {
  PropertiesService.getScriptProperties().setProperty("ORCHESTRATOR_WEBHOOK_URL", url);
}
