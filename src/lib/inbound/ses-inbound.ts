/**
 * SES inbound transport (rhodes-inbound-multitenancy-plan.md §4). Turns a raw
 * MIME email (delivered by SES to our S3 bucket) into the SAME InboundMessage
 * shape the Gmail transport produces, so everything downstream — triage,
 * ingest, SafeSend, the auth/flood-cap hardening — is unchanged.
 *
 * Two SES-specific wins over the Gmail path:
 *  - Attachments arrive PARSED (bytes inline) — no lazy getAttachment fetch.
 *  - SES runs SPF/DKIM/DMARC **and spam + virus** scanning and hands the
 *    verdicts in the receipt notification. We map those directly into `auth`
 *    (more reliable than parsing the header) and expose spam/virus so the
 *    worker can hold/drop flagged mail — free AV at the front door.
 */
import PostalMime from "postal-mime";
import { evaluateAuthResults, type InboundAttachment, type InboundMessage } from "./gmail";

/** SES verdict values from the receipt (`Message.receipt.*Verdict.status`). */
export type SesVerdict = "PASS" | "FAIL" | "GRAY" | "PROCESSING_FAILED" | string;

export type SesReceipt = {
  spf?: SesVerdict;
  dkim?: SesVerdict;
  dmarc?: SesVerdict;
  spam?: SesVerdict;
  virus?: SesVerdict;
  /** The actual recipient SES matched (our unique docs.rhodesoffice.ai address). */
  recipient?: string;
};

const sesToVerdict = (v?: SesVerdict): string | null =>
  v === "PASS" ? "pass" : v === "FAIL" ? "fail" : v ? v.toLowerCase() : null;

/**
 * Parse a raw MIME message into an InboundMessage.
 * @param raw       the full RFC822 bytes (fetched from S3)
 * @param messageId stable id (SES messageId / S3 key) — dedup key downstream
 * @param receipt   optional SES verdicts + matched recipient (preferred over
 *                  header parsing when present)
 */
export async function parseRawEmail(
  raw: Buffer | Uint8Array | string,
  messageId: string,
  receipt?: SesReceipt,
): Promise<InboundMessage> {
  const email = await PostalMime.parse(raw);

  const fromEmail = (email.from?.address ?? "").trim().toLowerCase();
  const subject = email.subject ?? "";
  const bodyText = (email.text ?? (email.html ? stripHtml(email.html) : ""))
    .replace(/\s+/g, " ")
    .slice(0, 20_000);
  const links = Array.from(new Set(bodyText.match(/https?:\/\/[^\s"'<>()]+/g) ?? []));

  const attachments: InboundAttachment[] = (email.attachments ?? []).map((a, i) => {
    const bytes = Buffer.from(a.content as ArrayBuffer);
    return {
      attachmentId: `ses-${i}`,
      filename: a.filename || `attachment-${i}`,
      mimeType: a.mimeType || "application/octet-stream",
      size: bytes.length,
      bytes,
    };
  });

  // Auth: prefer SES's own verdicts; fall back to the Authentication-Results
  // header. SES verdicts feed the SAME `verified` logic as Gmail.
  const auth = receipt
    ? evaluateAuthResults(
        `spf=${sesToVerdict(receipt.spf) ?? "none"}; ` +
          `dkim=${sesToVerdict(receipt.dkim) ?? "none"}; ` +
          `dmarc=${sesToVerdict(receipt.dmarc) ?? "none"}`,
      )
    : evaluateAuthResults(headerValue(email, "authentication-results"));

  return {
    id: messageId,
    threadId: messageId,
    internalDate: email.date ? Date.parse(email.date) || Date.now() : Date.now(),
    from: email.from?.name ? `${email.from.name} <${fromEmail}>` : fromEmail,
    fromEmail,
    subject,
    snippet: bodyText.slice(0, 200),
    bodyText,
    links,
    attachments,
    auth,
  };
}

/** SES flags spam/virus in the receipt — the worker can hold/drop on these. */
export function sesThreatFlags(receipt?: SesReceipt): { spam: boolean; virus: boolean } {
  return { spam: receipt?.spam === "FAIL", virus: receipt?.virus === "FAIL" };
}

function headerValue(email: { headers?: Array<{ key: string; value: string }> }, name: string): string {
  return email.headers?.find((h) => h.key.toLowerCase() === name)?.value ?? "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}
