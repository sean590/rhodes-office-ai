/**
 * AWS SES inbound transport (multi-tenant Plan A).
 *
 * Mail to `<local_part>@docs.rhodesoffice.ai` is received by SES (us-west-2),
 * stored in S3, and announced over SNS to /api/inbound/ses. This module:
 *   1. verifies the SNS message signature (a public webhook must not trust its
 *      body) and confirms subscriptions,
 *   2. resolves the recipient address → org via inbound_addresses,
 *   3. fetches the raw MIME from S3 and parses it (postal-mime),
 *   4. builds the SAME normalized InboundMessage the Gmail transport produces —
 *      reusing SES's own SPF/DKIM/DMARC verdicts through evaluateAuthResults so
 *      the auth gate is identical — and hands it to ingestInboundMessage.
 *
 * The org resolution + one-pipeline ingestion are the only things new here; the
 * auth gate, triage, flood caps, and document pipeline are all shared with the
 * Gmail poller (worker.ts).
 */
import { createVerify, randomBytes } from "crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import PostalMime from "postal-mime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateAuthResults, type InboundMessage, type InboundAttachment } from "./gmail";
import { ingestInboundMessage } from "./worker";

export const SES_REGION = process.env.INBOUND_SES_REGION || "us-west-2";
export const INBOUND_DOMAIN = process.env.INBOUND_DOMAIN || "docs.rhodesoffice.ai";

type Admin = SupabaseClient;

// ── SNS envelope + signature verification ────────────────────────────────────

export interface SnsEnvelope {
  Type: "SubscriptionConfirmation" | "Notification" | "UnsubscribeConfirmation";
  MessageId: string;
  Token?: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  SubscribeURL?: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
}

/** Keys (in order) that form the string-to-sign for each SNS message type. */
const SIGN_KEYS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

/** SigningCertURL must be an AWS SNS host over https — otherwise an attacker
 *  could point us at a cert they control. */
function isTrustedCertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** Verify an SNS message's RSA signature against AWS's published certificate. */
export async function verifySnsSignature(msg: SnsEnvelope): Promise<boolean> {
  const keys = SIGN_KEYS[msg.Type];
  if (!keys) return false;
  if (!isTrustedCertUrl(msg.SigningCertURL)) return false;

  let stringToSign = "";
  for (const key of keys) {
    const val = (msg as unknown as Record<string, string>)[key];
    if (val === undefined) continue; // Subject is optional
    stringToSign += `${key}\n${val}\n`;
  }

  let pem: string;
  try {
    const res = await fetch(msg.SigningCertURL);
    if (!res.ok) return false;
    pem = await res.text();
  } catch {
    return false;
  }

  const algo = msg.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  try {
    const verifier = createVerify(algo);
    verifier.update(stringToSign, "utf8");
    return verifier.verify(pem, msg.Signature, "base64");
  } catch {
    return false;
  }
}

/** Confirm an SNS subscription by fetching its SubscribeURL. */
export async function confirmSnsSubscription(msg: SnsEnvelope): Promise<boolean> {
  if (!msg.SubscribeURL || !isTrustedCertUrl(msg.SigningCertURL)) return false;
  try {
    // SubscribeURL is on the same sns.<region>.amazonaws.com host family.
    const u = new URL(msg.SubscribeURL);
    if (!/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) return false;
    const res = await fetch(msg.SubscribeURL);
    return res.ok;
  } catch {
    return false;
  }
}

// ── SES notification → InboundMessage ────────────────────────────────────────

interface SesReceived {
  notificationType: string;
  mail: {
    messageId: string;
    source: string;
    destination: string[];
    timestamp: string;
    commonHeaders?: { from?: string[]; to?: string[]; subject?: string; date?: string };
  };
  receipt: {
    spfVerdict?: { status: string };
    dkimVerdict?: { status: string };
    dmarcVerdict?: { status: string };
    action?: { type: string; bucketName?: string; objectKey?: string };
  };
}

/** Turn SES's structured verdicts into the same Authentication-Results string
 *  the Gmail path parses, so evaluateAuthResults applies one identical gate. */
function authHeaderFromReceipt(r: SesReceived["receipt"]): string {
  const parts: string[] = [];
  const add = (mech: string, v?: { status: string }) => {
    if (v?.status) parts.push(`${mech}=${v.status.toLowerCase()}`);
  };
  add("spf", r.spfVerdict);
  add("dkim", r.dkimVerdict);
  add("dmarc", r.dmarcVerdict);
  return parts.join("; ");
}

function parseAddr(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

/** Resolve which org owns any of the recipient addresses. Null = not ours. */
export async function resolveOrgByRecipients(admin: Admin, recipients: string[]): Promise<string | null> {
  const locals = recipients
    .map((r) => parseAddr(r))
    .filter((a) => a.endsWith(`@${INBOUND_DOMAIN}`))
    .map((a) => a.slice(0, a.indexOf("@")));
  if (!locals.length) return null;
  const { data } = await admin
    .from("inbound_addresses")
    .select("organization_id, local_part")
    .eq("domain", INBOUND_DOMAIN)
    .eq("is_active", true)
    .in("local_part", locals)
    .limit(1);
  return (data?.[0]?.organization_id as string) ?? null;
}

async function fetchRawEmail(bucket: string, key: string): Promise<Buffer> {
  const s3 = new S3Client({ region: SES_REGION });
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

const LINK_RE = /https?:\/\/[^\s"'<>)]+/gi;

/** Parse raw MIME into the normalized InboundMessage (auth from SES verdicts). */
export async function buildInboundMessageFromMime(
  sesMail: SesReceived["mail"],
  receipt: SesReceived["receipt"],
  rawMime: Buffer,
): Promise<InboundMessage> {
  const email = await PostalMime.parse(rawMime);
  const fromRaw = sesMail.commonHeaders?.from?.[0] || sesMail.source || email.from?.address || "";
  const bodyText = (email.text || (email.html ? email.html.replace(/<[^>]+>/g, " ") : "")).slice(0, 20000);
  const links = Array.from(new Set((bodyText.match(LINK_RE) || []).map((l) => l.replace(/[.,);]+$/, ""))));

  const attachments: InboundAttachment[] = (email.attachments || [])
    .filter((a) => a.content && (a.disposition === "attachment" || !!a.filename))
    .map((a) => {
      const content = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content as ArrayBuffer);
      return {
        attachmentId: "",
        filename: a.filename || "attachment",
        mimeType: a.mimeType || "application/octet-stream",
        size: content.length,
        content,
      };
    });

  return {
    id: sesMail.messageId,
    threadId: sesMail.messageId,
    internalDate: sesMail.timestamp ? Date.parse(sesMail.timestamp) : Date.now(),
    from: fromRaw,
    fromEmail: parseAddr(fromRaw),
    subject: sesMail.commonHeaders?.subject || email.subject || "",
    snippet: bodyText.slice(0, 200),
    bodyText,
    links,
    attachments,
    auth: evaluateAuthResults(authHeaderFromReceipt(receipt)),
  };
}

/**
 * Handle a verified SNS "Notification" carrying an SES receipt: resolve the
 * org, fetch + parse the email, and ingest it through the shared pipeline.
 * Returns a short status for logging. Never throws on "not for us".
 */
export async function handleSesNotification(admin: Admin, snsMessage: string): Promise<{ status: string }> {
  let ses: SesReceived;
  try {
    ses = JSON.parse(snsMessage) as SesReceived;
  } catch {
    return { status: "unparseable" };
  }
  if (ses.notificationType !== "Received") return { status: `ignored:${ses.notificationType}` };

  const orgId = await resolveOrgByRecipients(admin, ses.mail?.destination || []);
  if (!orgId) return { status: "no_matching_address" };

  const action = ses.receipt?.action;
  if (action?.type !== "S3" || !action.bucketName || !action.objectKey) {
    return { status: "no_s3_object" };
  }

  const rawMime = await fetchRawEmail(action.bucketName, action.objectKey);
  const msg = await buildInboundMessageFromMime(ses.mail, ses.receipt, rawMime);
  await ingestInboundMessage(admin, orgId, msg);
  return { status: "ingested" };
}

// ── Address provisioning ─────────────────────────────────────────────────────

/** Base32-ish token (no vowels/ambiguous chars) for a readable, unguessable
 *  local part. */
function newLocalPart(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const raw = randomBytes(10);
  let out = "rhodes-";
  for (let i = 0; i < 8; i++) out += alphabet[raw[i] % alphabet.length];
  return out;
}

/** Insert a fresh active address, retrying on the (very unlikely) collision. */
async function insertNewAddress(admin: Admin, orgId: string, createdBy?: string | null): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const local = newLocalPart();
    const { error } = await admin.from("inbound_addresses").insert({
      organization_id: orgId,
      local_part: local,
      domain: INBOUND_DOMAIN,
      created_by: createdBy ?? null,
    });
    if (!error) return `${local}@${INBOUND_DOMAIN}`;
    if (!/duplicate|unique/i.test(error.message)) throw new Error(`provision inbound address: ${error.message}`);
  }
  throw new Error("could not provision a unique inbound address");
}

/** The org's active hosted address, provisioning one on first use. */
export async function getOrCreateInboundAddress(admin: Admin, orgId: string, createdBy?: string | null): Promise<string> {
  const { data: existing } = await admin
    .from("inbound_addresses")
    .select("local_part, domain")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (existing) return `${existing.local_part}@${existing.domain}`;
  return insertNewAddress(admin, orgId, createdBy);
}

/**
 * Rotate the org's hosted address: deactivate the current one(s) and mint a
 * fresh token. Use when an address may have leaked — mail to the old address
 * stops resolving immediately (resolveOrgByRecipients requires is_active). The
 * old rows are retained (is_active=false) for audit, not deleted.
 */
export async function rotateInboundAddress(admin: Admin, orgId: string, createdBy?: string | null): Promise<string> {
  await admin
    .from("inbound_addresses")
    .update({ is_active: false })
    .eq("organization_id", orgId)
    .eq("is_active", true);
  return insertNewAddress(admin, orgId, createdBy);
}
