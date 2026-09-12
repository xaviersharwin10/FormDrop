/**
 * One-time setup: exchanges a Google OAuth "Desktop app" client for a
 * refresh token authorized to send mail as one Gmail account, via the
 * loopback flow (Google deprecated the old out-of-band/manual-code flow
 * in 2023 — this is the current replacement for a script with no public
 * callback URL).
 *
 * Prerequisites (Google Cloud Console, console.cloud.google.com):
 *   1. Create/select a project, enable the "Gmail API" (APIs & Services
 *      -> Library -> search "Gmail API" -> Enable).
 *   2. OAuth consent screen -> External -> add the Gmail address that will
 *      send claim emails as a test user. Leave the app in "Testing"
 *      status — gmail.send doesn't need Google's verification review for
 *      up to 100 test users.
 *   3. Credentials -> Create Credentials -> OAuth client ID -> Application
 *      type: Desktop app. Copy the client id + secret into
 *      services/orchestrator/.env as GOOGLE_OAUTH_CLIENT_ID and
 *      GOOGLE_OAUTH_CLIENT_SECRET.
 *
 * Run once: pnpm gmail:setup-oauth
 * Open the printed URL, sign in as the sending Gmail account, approve.
 * The script prints a refresh token — paste it into .env as
 * GOOGLE_OAUTH_REFRESH_TOKEN (and into Render's env vars for production).
 */
import { createServer } from "node:http";

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first (see this file's header comment).",
    );
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent"); // forces a refresh_token even on repeat runs

  console.log("\nOpen this URL, sign in as the Gmail account that should send claim emails, and approve:\n");
  console.log(authUrl.toString());
  console.log(`\nWaiting for the redirect back to ${REDIRECT_URI} ...`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.end(error ? `Authorization failed: ${error}. You can close this tab.` : "Authorized — you can close this tab.");
      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error("No code or error in redirect"));
    });
    server.listen(PORT);
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: HTTP ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string };
  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh_token in the response — Google only issues one the first time an app is authorized " +
        "with prompt=consent. Revoke prior access at https://myaccount.google.com/permissions and try again.",
    );
  }

  console.log("\nAdd these to services/orchestrator/.env (and to Render's env vars for production):");
  console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`);
  console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`);
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(`GMAIL_SENDER_EMAIL=<the Gmail address you just signed in as>`);
}

main().catch((err) => {
  console.error("Gmail OAuth setup failed:", err);
  process.exit(1);
});
