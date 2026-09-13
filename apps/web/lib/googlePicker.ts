/**
 * Google Picker integration — lets a creator pick one of their own Google
 * Forms from a real Drive browser instead of typing/pasting a raw form ID.
 *
 * Deliberately separate from the server-side "Connect Google Forms" OAuth
 * flow (googleFormsAuth.ts / GOOGLE_FORMS_OAUTH_CLIENT_ID on the backend):
 * the Picker needs a short-lived access token available directly in the
 * browser (Google Identity Services' token client), scoped to `drive.file`
 * only — the least-privilege scope Google's own Picker guide recommends,
 * since combined with the Picker it lets the user browse and select from
 * all their files while the app only ever gains access to whatever they
 * actually pick. It reuses the same OAuth client ID as the backend flow
 * (client IDs aren't secret), just with "Authorized JavaScript origins"
 * added to it in Cloud Console — a separate config step from the
 * "Authorized redirect URIs" the server-side flow needs.
 */

const PICKER_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_FORM_MIME_TYPE = "application/vnd.google-apps.form";

/**
 * `drive.file` — the same scope the Picker itself uses — is also one of
 * the scopes Google's Forms API accepts for `forms.get` (confirmed against
 * the API's own reference docs), so this needs no extra consent screen or
 * backend round-trip: the token the Picker already obtained for the
 * selected file is enough to read its settings directly.
 */
async function formCollectsVerifiedEmail(formId: string, accessToken: string): Promise<boolean> {
  const res = await fetch(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Couldn't read this form's settings (HTTP ${res.status})`);
  const form = (await res.json()) as { settings?: { emailCollectionType?: string } };
  return form.settings?.emailCollectionType === "VERIFIED";
}

declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

let gapiScriptPromise: Promise<void> | null = null;
let gisScriptPromise: Promise<void> | null = null;
let pickerLibraryPromise: Promise<void> | null = null;
let tokenClient: any = null;
let cachedAccessToken: string | null = null;

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadPickerLibrary(): Promise<void> {
  if (!pickerLibraryPromise) {
    pickerLibraryPromise = (async () => {
      if (!gapiScriptPromise) gapiScriptPromise = loadScriptOnce("https://apis.google.com/js/api.js");
      if (!gisScriptPromise) gisScriptPromise = loadScriptOnce("https://accounts.google.com/gsi/client");
      await Promise.all([gapiScriptPromise, gisScriptPromise]);
      await new Promise<void>((resolve) => window.gapi.load("picker", resolve));
    })();
  }
  return pickerLibraryPromise;
}

function getAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (cachedAccessToken) {
      resolve(cachedAccessToken);
      return;
    }
    if (!tokenClient) {
      tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: PICKER_SCOPE,
        callback: (response: { access_token?: string; error?: string }) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error ?? "Google sign-in was cancelled"));
            return;
          }
          cachedAccessToken = response.access_token;
          resolve(response.access_token);
        },
      });
    }
    tokenClient.requestAccessToken();
  });
}

export interface GoogleFormPickerConfig {
  clientId: string;
  apiKey: string;
  /** Cloud project NUMBER (numeric), not the project ID string. */
  appId: string;
}

/**
 * Opens the picker (prompting for Google sign-in/consent first if needed),
 * filtered to Google Forms only. Calls onPicked with the selected form's
 * file ID, which is the same value used everywhere else in this app as
 * `formId`.
 */
export async function openGoogleFormPicker(
  config: GoogleFormPickerConfig,
  onPicked: (formId: string) => void,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await loadPickerLibrary();
    const accessToken = await getAccessToken(config.clientId);

    const view = new window.google!.picker.DocsView(window.google!.picker.ViewId.DOCS)
      .setMimeTypes(GOOGLE_FORM_MIME_TYPE)
      .setIncludeFolders(true);

    const picker = new window.google!.picker.PickerBuilder()
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setOAuthToken(accessToken)
      .addView(view)
      .setCallback(async (data: any) => {
        if (data.action !== window.google!.picker.Action.PICKED) return;
        const doc = data[window.google!.picker.Response.DOCUMENTS][0];
        const formId = doc[window.google!.picker.Document.ID];
        try {
          const collectsVerifiedEmail = await formCollectsVerifiedEmail(formId, accessToken);
          if (!collectsVerifiedEmail) {
            onError(
              "This form doesn't collect verified email addresses yet — FormDrop needs one to pay respondents. " +
                "In the form's Settings → Responses, turn on \"Collect email addresses\" set to \"Verified\", then pick it again.",
            );
            return;
          }
          onPicked(formId);
        } catch (err) {
          onError((err as Error).message);
        }
      })
      .build();
    picker.setVisible(true);
  } catch (err) {
    // An expired/invalid cached token is the most likely recoverable
    // failure — clear it so the next attempt re-prompts instead of
    // repeating the same failure silently.
    cachedAccessToken = null;
    onError((err as Error).message);
  }
}
