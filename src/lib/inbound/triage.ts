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
const DELIVERY_PHRASE =
  /secure (message|file|document|link)|document[s]? (are|is|has been)? ?(ready|available|shared|delivered|uploaded)|has (sent|shared) (a|the|your)|(view|download|access) (your|the) (file|document|return|statement|k-?1)|tax (return|package|document)|k-?1|capital (call|account)|distribution notice|protected message/i;

export type TriageResult = {
  classification: "attachment" | "safesend" | "needs_user" | "ignored";
  reason: string;
  ingestableAttachments: InboundMessage["attachments"];
  safesendLink: string | null;
};

export function triageMessage(
  msg: InboundMessage,
  opts: { knownProviderSender: boolean },
): TriageResult {
  const ingestable = msg.attachments.filter(
    (a) =>
      INGESTABLE_MIME.has(a.mimeType) &&
      !NOISE_ATTACHMENT.test(a.filename) &&
      !SIGNATURE_IMAGE.test(a.filename) &&
      !(a.mimeType.startsWith("image/") && a.size < SMALL_IMAGE_BYTES) &&
      a.size > 0,
  );

  if (ingestable.length > 0) {
    return {
      classification: "attachment",
      reason: `${ingestable.length} ingestable attachment(s)`,
      ingestableAttachments: ingestable,
      safesendLink: null,
    };
  }

  const safesendLink =
    msg.links.find((l) => SAFESEND_DOWNLOAD.test(l) && !SAFESEND_UPLOAD.test(l)) ??
    (SAFESEND_HOST.test(msg.fromEmail)
      ? msg.links.find((l) => SAFESEND_HOST.test(l) && !SAFESEND_UPLOAD.test(l)) ?? null
      : null);
  if (safesendLink) {
    return {
      classification: "safesend",
      reason: "SafeSend download link",
      ingestableAttachments: [],
      safesendLink,
    };
  }

  const portalSender = PORTAL_SENDER.some((re) => re.test(msg.fromEmail) || re.test(msg.from));
  const deliveryish = DELIVERY_PHRASE.test(msg.subject) || DELIVERY_PHRASE.test(msg.bodyText);

  // A known provider (directory match or portal platform) talking about a
  // document, or ANY sender clearly announcing a waiting document with a
  // link, is a delivery Rhodes can't fetch in v1.
  if (portalSender || (opts.knownProviderSender && deliveryish) || (deliveryish && msg.links.length > 0)) {
    return {
      classification: "needs_user",
      reason: portalSender
        ? "portal/secure-delivery notification"
        : opts.knownProviderSender
          ? "known provider announcing a document"
          : "delivery-style message with link",
      ingestableAttachments: [],
      safesendLink: null,
    };
  }

  return { classification: "ignored", reason: "no delivery signals", ingestableAttachments: [], safesendLink: null };
}
