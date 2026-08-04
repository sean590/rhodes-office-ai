import type { InboundMessage } from "./gmail";

/**
 * Inbound triage — deterministic-first classification of a mailbox message.
 *
 * v1 rule of thumb (rhodes-inbound-v1-build-plan.md): better to over-nudge
 * than silently miss a delivery. Order:
 *   1. ingestable attachments        → 'attachment'  (auto-ingest)
 *   2. SafeSend-class secure link    → 'safesend'    (auto-retrieve, Incr. 2)
 *   3. looks like a document delivery→ 'needs_user'  (notify + email nudge)
 *   4. everything else              → 'ignored'
 *
 * No LLM in this pass — deterministic and predictable; an ambiguity-only
 * LLM classifier is Increment-3 polish if the heuristics prove too coarse.
 */

// Mirrors ALLOWED_MIME_TYPES in lib/validations.ts (upload path parity),
// minus text/plain: nearly every marketing email carries a text/plain part or
// stray .txt attachment, and a real provider doc is never a bare .txt.
const INGESTABLE_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
]);

// Attachment names that are noise even in real mail (logos, signatures,
// calendar invites).
const NOISE_ATTACHMENT = /\.(ics|vcf|p7s|asc)$/i;
// Inline signature/logo images: mail clients name them imageNNN.*; also skip
// any small image outright — a real scanned document photo is never <50KB.
// (Found live: a forwarded financials email carried 5 signature PNGs that
// would each have burned an extraction run.)
const SIGNATURE_IMAGE = /^image\d+\.(png|gif|jpe?g)$/i;
const SMALL_IMAGE_BYTES = 50_000;

// SafeSend: download links are /SendLinkRedirect/; /DropOff/ is their UPLOAD
// form — never follow it (spike lesson).
const SAFESEND_HOST = /safesend(returns)?\.com/i;
const SAFESEND_DOWNLOAD = /SendLinkRedirect/i;
const SAFESEND_UPLOAD = /\/DropOff\//i;

// The sandbox will VISIT whatever we classify as safesend, so the parsed
// hostname must be a real SafeSend domain — a path/query merely containing
// "SendLinkRedirect" is attacker-craftable (evil.com/SendLinkRedirect/x).
// Near-misses aren't dropped: they fall through to needs_user, and the
// ledger tells us which legit variants (white-labels) to allowlist later.
const SAFESEND_ALLOWED_HOST = /(^|\.)safesend(returns)?\.com$/i;
function isSafesendHost(link: string): boolean {
  try {
    return SAFESEND_ALLOWED_HOST.test(new URL(link).hostname);
  } catch {
    return false;
  }
}

// Known secure-delivery / portal notification senders (spike pattern catalog).
// These are deliveries Rhodes cannot fetch in v1 → needs_user.
const PORTAL_SENDER = [
  /sf-notifications\.com/i, // ShareFile
  /sharefile\.com/i,
  /extranet@andersen\.com/i,
  /andersen\.com/i,
  /shareplex|smartvault|suralink|taxcaddy|liscio/i,
  /donotreply@.*portal/i,
];

// Body/subject phrases that signal "a document is waiting for you somewhere".
// DELIVERY *INTENT* only — never bare document nouns. A CPA thread mentions
// "the tax return" / "K-1" / "capital account" in ordinary bookkeeping
// conversation constantly; those are NOT deliveries. We require an action
// ("ready/available/shared", "view/download your …", "secure file", "has sent")
// so replies-about-documents don't get misread as fetch-failures. The
// view/download construction allows an adjective ("view your tax return").
const DELIVERY_PHRASE =
  /secure (message|file|document|link)|document[s]? (are|is|has been)? ?(ready|available|shared|delivered|uploaded)|has (sent|shared) (a|the|your)|(view|download|access) (your|the)(\s\w+)? (file|document|return|statement|k-?1)|capital call|distribution notice|protected message/i;

export type TriageResult = {
  classification: "attachment" | "safesend" | "needs_user" | "ignored";
  reason: string;
  ingestableAttachments: InboundMessage["attachments"];
  safesendLink: string | null;
  /** Every candidate download link in the body (multi-link threads) —
   * retrieval falls back to the next when one is expired/locked/rejected. */
  safesendLinks: string[];
};

export function triageMessage(
  msg: InboundMessage,
  opts: {
    knownProviderSender: boolean;
    /** The "This is a delivery" teach action learned this sender. */
    learnedDeliverySender?: boolean;
    /** SPF/DKIM/DMARC verdict from gmail.ts. Defaults to true so the force-
     *  ingest release path (and synthesized messages) can bypass the gate;
     *  the poll worker ALWAYS passes the real verdict. */
    senderVerified?: boolean;
  },
): TriageResult {
  const senderVerified = opts.senderVerified !== false;
  const ingestable = msg.attachments.filter(
    (a) =>
      INGESTABLE_MIME.has(a.mimeType) &&
      !NOISE_ATTACHMENT.test(a.filename) &&
      !SIGNATURE_IMAGE.test(a.filename) &&
      !(a.mimeType.startsWith("image/") && a.size < SMALL_IMAGE_BYTES) &&
      a.size > 0,
  );

  if (ingestable.length > 0) {
    // Active-spoof gate: the caller passes senderVerified=false ONLY on a strong
    // spoof signal (dmarc=fail — the From domain publishes DMARC and this
    // message failed it), the forged-capital-call attack. Everything else
    // (incl. "gray" forwards) auto-ingests; this holds just the dangerous case.
    if (!senderVerified) {
      return {
        classification: "needs_user",
        reason: "sender failed DMARC — possible spoof, held for review",
        ingestableAttachments: [],
        safesendLink: null,
        safesendLinks: [],
      };
    }
    return {
      classification: "attachment",
      reason: `${ingestable.length} ingestable attachment(s)`,
      ingestableAttachments: ingestable,
      safesendLink: null,
      safesendLinks: [],
    };
  }

  const safesendLinks = msg.links.filter(
    (l) =>
      !SAFESEND_UPLOAD.test(l) &&
      isSafesendHost(l) &&
      (SAFESEND_DOWNLOAD.test(l) || SAFESEND_HOST.test(msg.fromEmail)),
  );
  if (safesendLinks.length > 0 && senderVerified) {
    return {
      classification: "safesend",
      reason: "SafeSend download link",
      ingestableAttachments: [],
      safesendLink: safesendLinks[0],
      safesendLinks,
    };
  }
  if (safesendLinks.length > 0) {
    // Real SafeSend host but unauthenticated sender — genuine SafeSend mail
    // always passes DMARC, so treat the mismatch as suspicious, not fetchable.
    return {
      classification: "needs_user",
      reason: "sender failed authentication",
      ingestableAttachments: [],
      safesendLink: null,
      safesendLinks: [],
    };
  }

  // SendLinkRedirect-shaped link on a host we don't recognize: never visit it,
  // but never silently drop it either — could be a white-labeled SafeSend.
  if (msg.links.some((l) => SAFESEND_DOWNLOAD.test(l) && !isSafesendHost(l))) {
    return {
      classification: "needs_user",
      reason: "secure link on an unrecognized host",
      ingestableAttachments: [],
      safesendLink: null,
      safesendLinks: [],
    };
  }

  const portalSender = PORTAL_SENDER.some((re) => re.test(msg.fromEmail) || re.test(msg.from));
  const deliveryish = DELIVERY_PHRASE.test(msg.subject) || DELIVERY_PHRASE.test(msg.bodyText);
  // Links that could plausibly BE a delivery. A SafeSend DropOff (upload) link
  // — standard CPA signature boilerplate — is where you SEND files, never a
  // fetchable delivery, so it must not make an ordinary reply "deliveryish".
  const deliveryLinks = msg.links.filter((l) => !SAFESEND_UPLOAD.test(l));

  // A known provider (directory match or portal platform) clearly announcing a
  // document, or ANY sender announcing a waiting document with a fetchable
  // link, is a delivery Rhodes can't fetch in v1.
  if (portalSender || opts.learnedDeliverySender || (opts.knownProviderSender && deliveryish) || (deliveryish && deliveryLinks.length > 0)) {
    return {
      classification: "needs_user",
      reason: portalSender
        ? "portal/secure-delivery notification"
        : opts.learnedDeliverySender
          ? "known provider announcing a document"
          : opts.knownProviderSender
            ? "known provider announcing a document"
            : "delivery-style message with link",
      ingestableAttachments: [],
      safesendLink: null,
      safesendLinks: [],
    };
  }

  return { classification: "ignored", reason: "no delivery signals", ingestableAttachments: [], safesendLink: null, safesendLinks: [] };
}
