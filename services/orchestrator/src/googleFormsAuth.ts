import { config, requireGoogleFormsConfig } from "./config.js";

// forms.responses.readonly is the actual working scope; userinfo.email is only
// so we can show "connected as you@gmail.com" in the dashboard — not used for
// anything Forms-related.
export const GOOGLE_FORMS_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/forms.responses.readonly https://www.googleapis.com/auth/userinfo.email";

export function googleFormsRedirectUri(): string {
  return `${config.orchestratorBaseUrl}/auth/google/callback`;
}

/** `state` round-trips the creator id through Google's redirect — this flow has no session of its own. */
export function googleFormsAuthUrl(state: string): string {
  const { googleFormsOAuthClientId } = requireGoogleFormsConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", googleFormsOAuthClientId);
  url.searchParams.set("redirect_uri", googleFormsRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_FORMS_OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent"); // guarantees a refresh_token even if this creator connected before
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const { googleFormsOAuthClientId, googleFormsOAuthClientSecret } = requireGoogleFormsConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleFormsOAuthClientId,
      client_secret: googleFormsOAuthClientSecret,
      redirect_uri: googleFormsRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Forms OAuth code exchange failed: HTTP ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function getAccessTokenFromRefreshToken(refreshToken: string): Promise<string> {
  const { googleFormsOAuthClientId, googleFormsOAuthClientSecret } = requireGoogleFormsConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleFormsOAuthClientId,
      client_secret: googleFormsOAuthClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Forms OAuth token refresh failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

/** The connecting Google account's own email — shown in the dashboard so a creator can see who's connected. */
export async function getGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo lookup failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { email: string };
  return data.email;
}
