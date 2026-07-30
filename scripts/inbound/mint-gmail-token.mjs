// Mint a Gmail OAuth refresh token for the inbound mailbox (gmail.readonly).
//
// Usage:  node scripts/inbound/mint-gmail-token.mjs <credentials.json> <out.json>
//
// Opens the Google consent screen in the default browser; sign in as the
// MAILBOX account (Rhodes@channels.com — not your personal account). The
// refresh token is written to <out.json> (mode 600) and NEVER printed.
// Values then go into Vercel env (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN);
// delete <out.json> after.
//
// Gotcha: if Google shows "access blocked / app not verified", the OAuth
// consent screen is in Testing mode — add the mailbox account as a Test
// User in Google Cloud Console → APIs & Services → OAuth consent screen.

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";

const [credsPath, outPath] = process.argv.slice(2);
if (!credsPath || !outPath) {
  console.error("usage: node mint-gmail-token.mjs <credentials.json> <out.json>");
  process.exit(1);
}

const creds = JSON.parse(readFileSync(credsPath, "utf8"));
const { client_id, client_secret } = creds.installed ?? creds.web ?? {};
if (!client_id || !client_secret) {
  console.error("credentials.json has no installed/web client");
  process.exit(1);
}

const PORT = 8788;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // force a NEW refresh token even if previously granted
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") return res.end();
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("Missing code — check the terminal.");
    console.error("callback had no code:", url.searchParams.get("error"));
    process.exit(1);
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    res.end("No refresh token returned — check the terminal.");
    console.error("token exchange result had no refresh_token:", tokens.error ?? "(unknown)");
    process.exit(1);
  }
  writeFileSync(outPath, JSON.stringify({ client_id, client_secret, refresh_token: tokens.refresh_token }), { mode: 0o600 });
  res.end("Done — token captured. You can close this tab.");
  console.log(`refresh token written to ${outPath} (not displayed)`);
  server.close();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log("Opening Google consent — sign in as the MAILBOX account (Rhodes@channels.com).");
  execFile("open", [authUrl], (err) => {
    if (err) console.log("Open this URL manually:\n" + authUrl);
  });
});

setTimeout(() => {
  console.error("timed out after 10 minutes");
  process.exit(1);
}, 10 * 60_000);
