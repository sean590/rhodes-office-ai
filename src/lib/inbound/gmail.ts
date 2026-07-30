/**
 * Gmail transport for inbound v1 — raw REST (no googleapis dep).
 *
 * Reads Rhodes' OWN mailbox (Rhodes@channels.com; providers see the
 * Rhodes@channels.com alias). Auth = OAuth refresh token minted once by Sean
 * (gmail.readonly). Secrets live in env, never the repo:
 *   GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
 *
 * Ported spike lessons (spike/lib-gmail.mjs, otp.mjs):
 *  - OTP wait = snapshot existing message IDs, wait for a genuinely NEW one.
 *    NEVER timestamp math (clock skew between us and Google silently excluded
 *    fresh codes in the spike).
 *  - Search with `in:anywhere` — some provider senders land in spam
 *    (p=QUARANTINE) and are invisible to plain queries.
 *  - OTP emails are often HTML-only base64 — search decoded body AND snippet.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

let cachedToken: { token: string; expiresAt: number } | null = null;

export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN,
  );
}

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`gmail token refresh failed: HTTP ${res.status}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function api<T>(path: string): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`gmail api ${path.split("?")[0]} failed: HTTP ${res.status}`);
  return res.json();
}

// ── Types (the subset of the Gmail schema we consume) ────────────────

type GmailHeader = { name: string; value: string };
type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
type GmailMessageRaw = {
  id: string;
  threadId: string;
  internalDate: string;
  snippet?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
};

export type InboundAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type InboundMessage = {
  id: string;
  threadId: string;
  internalDate: number; // ms epoch
  from: string; // raw From header
  fromEmail: string; // parsed address, lowercased
  subject: string;
  snippet: string;
  bodyText: string; // decoded text/plain + text/html (tags stripped), truncated
  links: string[]; // http(s) links found in the body
  attachments: InboundAttachment[];
};

// ── Parsing helpers ──────────────────────────────────────────────────

function b64decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function header(msg: GmailMessageRaw, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function walkParts(part: GmailPart | undefined, out: { text: string[]; atts: InboundAttachment[] }) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) {
    out.atts.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body.size ?? 0,
    });
  } else if (part.body?.data && (part.mimeType === "text/plain" || part.mimeType === "text/html")) {
    const decoded = b64decode(part.body.data);
    out.text.push(part.mimeType === "text/html" ? decoded.replace(/<[^>]+>/g, " ") : decoded);
  }
  for (const p of part.parts ?? []) walkParts(p, out);
}

function toInbound(msg: GmailMessageRaw): InboundMessage {
  const out = { text: [] as string[], atts: [] as InboundAttachment[] };
  walkParts(msg.payload, out);
  const bodyText = out.text.join("\n").replace(/\s+/g, " ").slice(0, 20_000);
  const links = Array.from(new Set(bodyText.match(/https?:\/\/[^\s"'<>()]+/g) ?? []));
  const from = header(msg, "From");
  return {
    id: msg.id,
    threadId: msg.threadId,
    internalDate: Number(msg.internalDate),
    from,
    fromEmail: parseAddress(from),
    subject: header(msg, "Subject"),
    snippet: msg.snippet ?? "",
    bodyText,
    links,
    attachments: out.atts,
  };
}

// ── Public surface ───────────────────────────────────────────────────

/** The connected mailbox's own address (who the token belongs to). */
export async function getMailboxAddress(): Promise<string | null> {
  try {
    const profile = await api<{ emailAddress?: string }>("/profile");
    return profile.emailAddress ?? null;
  } catch {
    return null;
  }
}

/** New messages strictly after the given internalDate cursor, oldest first. */
export async function listNewMessages(sinceInternalDate: number, max = 25): Promise<InboundMessage[]> {
  // `after:` is seconds-granular; over-fetch a little and filter exactly by
  // internalDate. in:anywhere catches quarantined provider senders.
  const afterSec = Math.max(0, Math.floor(sinceInternalDate / 1000) - 60);
  const q = encodeURIComponent(`in:anywhere -in:chats after:${afterSec}`);
  const list = await api<{ messages?: { id: string }[] }>(`/messages?q=${q}&maxResults=${max}`);
  const full = await Promise.all(
    (list.messages ?? []).map((m) => api<GmailMessageRaw>(`/messages/${m.id}?format=full`)),
  );
  return full
    .map(toInbound)
    .filter((m) => m.internalDate > sinceInternalDate)
    .sort((a, b) => a.internalDate - b.internalDate);
}

/** Fetch a single message by id (failed-row retry + the teach action). */
export async function getMessage(id: string): Promise<InboundMessage | null> {
  try {
    return toInbound(await api<GmailMessageRaw>(`/messages/${id}?format=full`));
  } catch {
    return null;
  }
}

/** Download one attachment's bytes. */
export async function getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const data = await api<{ data: string }>(`/messages/${messageId}/attachments/${attachmentId}`);
  return Buffer.from(data.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Wait for a NEW OTP email and extract a code of `digits` length.
 * Snapshot-then-poll: only messages that did not exist at call time count
 * (spike lesson — clock skew broke timestamp anchoring).
 *
 * `senderContains` is optional: a code FORWARDED by the user (the SafeSend
 * relay flow — original recipient forwards the access-code email to Rhodes)
 * arrives from the user's address, not the platform's, so sender filtering
 * would miss it. `bodyMarker` narrows the candidate set instead.
 */
export async function waitForOtp(opts: {
  senderContains?: string;
  bodyMarker?: RegExp;
  digits: number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<string | null> {
  const { senderContains, bodyMarker, digits, timeoutMs = 5 * 60_000, pollMs = 5_000 } = opts;
  const q = encodeURIComponent(`in:anywhere${senderContains ? ` from:${senderContains}` : ""}`);
  const snapshot = new Set(
    ((await api<{ messages?: { id: string }[] }>(`/messages?q=${q}&maxResults=20`)).messages ?? []).map((m) => m.id),
  );
  const deadline = Date.now() + timeoutMs;
  const codeRe = new RegExp(`(?<!\\d)(\\d{${digits}})(?!\\d)`);
  while (Date.now() < deadline) {
    const list = (await api<{ messages?: { id: string }[] }>(`/messages?q=${q}&maxResults=20`)).messages ?? [];
    for (const m of list) {
      if (snapshot.has(m.id)) continue;
      const full = toInbound(await api<GmailMessageRaw>(`/messages/${m.id}?format=full`));
      const haystack = full.bodyText + " " + full.snippet + " " + full.subject;
      if (bodyMarker && !bodyMarker.test(haystack)) { snapshot.add(m.id); continue; }
      const match = haystack.match(codeRe);
      if (match) return match[1];
      snapshot.add(m.id); // new but code-less — don't re-fetch it every poll
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}
