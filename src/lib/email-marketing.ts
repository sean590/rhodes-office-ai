/**
 * Marketing email (audit A22 — CAN-SPAM + bulk-sender compliance). We do NOT
 * maintain our own suppression list: unsubscribe/suppression is commodity
 * plumbing and Resend (our email provider) owns the whole lifecycle when
 * marketing goes out as a BROADCAST to an AUDIENCE:
 *   - injects a working unsubscribe link ({{{RESEND_UNSUBSCRIBE_URL}}}),
 *   - sets List-Unsubscribe + List-Unsubscribe-Post (Gmail/Yahoo one-click),
 *   - maintains the suppression list itself and skips unsubscribed contacts on
 *     every future broadcast.
 * This module is the thin wrapper; transactional mail (offboarding, receipts,
 * deletion notices) stays on sendEmail() and is CAN-SPAM-exempt.
 *
 * Setup (done 2026-08-06): Resend "Marketing" segment
 * 6c69add9-4f40-4585-b30e-3db8cf9b8493 (RESEND_MARKETING_SEGMENT_ID). Resend's
 * model is contacts (global) + segments; broadcasts target a segmentId.
 * `audienceId` is deprecated in the SDK. The physical postal address below is
 * the other CAN-SPAM requirement and is baked into every footer.
 */
import { Resend } from "resend";

// Required physical postal address on every marketing message (CAN-SPAM §5).
export const MARKETING_POSTAL_ADDRESS =
  "8605 Santa Monica Blvd PMB 294903, West Hollywood, California 90069-4109 US";

const FROM = process.env.EMAIL_FROM || "Rhodes <noreply@notify.rhodesoffice.ai>";

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

// The Resend "Marketing" segment (created 2026-08-06). Not a secret — it's an
// identifier, useless without RESEND_API_KEY — so it's a code default, env-
// overridable if we ever rotate/segment further.
const MARKETING_SEGMENT_ID = "6c69add9-4f40-4585-b30e-3db8cf9b8493";
function marketingSegmentId(): string {
  return process.env.RESEND_MARKETING_SEGMENT_ID || MARKETING_SEGMENT_ID;
}

/**
 * CAN-SPAM footer: physical address + Resend's one-click unsubscribe merge tag.
 * {{{RESEND_UNSUBSCRIBE_URL}}} is expanded per-recipient by Resend at send time
 * (broadcasts only) and drives the List-Unsubscribe headers automatically.
 */
export function marketingFooter(): string {
  return (
    `<hr style="border:none;border-top:1px solid #e8e6df;margin:32px 0 16px" />` +
    `<p style="font-size:12px;color:#9494a0;line-height:1.5">` +
    `You're receiving this because you signed up for Rhodes updates.<br />` +
    `<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#6b6b76">Unsubscribe</a>` +
    ` &middot; ${MARKETING_POSTAL_ADDRESS}` +
    `</p>`
  );
}

/** Ensure the compliant footer is present exactly once. */
export function withMarketingFooter(html: string): string {
  return html.includes("{{{RESEND_UNSUBSCRIBE_URL}}}") ? html : html + marketingFooter();
}

// Brand color (matches the signup page). Solid + gradient — Outlook ignores the
// gradient and falls back to the solid background-color.
const BRAND_GREEN = "#2d5a3d";

/**
 * Render a fully branded marketing email: Rhodes logo lockup + heading + body +
 * optional CTA button + the CAN-SPAM footer. Table-based and inline-styled for
 * email-client compatibility; the logo is drawn in CSS (no hosted image needed).
 * Pass `bodyHtml` as one or more <p> blocks.
 */
export function renderMarketingEmail(opts: {
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  previewText?: string;
}): string {
  const preheader = opts.previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${opts.previewText}</div>`
    : "";
  const cta = opts.cta
    ? `<tr><td style="padding:0 40px 32px 40px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
      `<td style="background:${BRAND_GREEN};border-radius:10px">` +
      `<a href="${opts.cta.url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${opts.cta.label}</a>` +
      `</td></tr></table></td></tr>`
    : "";
  return (
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f4f0">${preheader}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<tr><td align="center"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e8e6df;border-radius:16px;overflow:hidden">` +
    // logo lockup
    `<tr><td style="padding:32px 40px 8px 40px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="width:40px;height:40px;background:${BRAND_GREEN};background-image:linear-gradient(135deg,${BRAND_GREEN},#3d7a53);border-radius:10px;color:#ffffff;font-size:20px;font-weight:700;text-align:center;line-height:40px">R</td>` +
    `<td style="padding-left:12px;font-size:20px;font-weight:600;letter-spacing:-0.02em;color:#1a1a1f">Rhodes</td>` +
    `</tr></table></td></tr>` +
    // body
    `<tr><td style="padding:16px 40px 8px 40px">` +
    `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;letter-spacing:-0.02em;color:#1a1a1f">${opts.heading}</h1>` +
    opts.bodyHtml +
    `</td></tr>` +
    cta +
    // footer
    `<tr><td style="padding:20px 40px 28px 40px;border-top:1px solid #e8e6df">` +
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#9494a0">` +
    `You're receiving this because you signed up for Rhodes updates.<br />` +
    `<a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#6b6b76">Unsubscribe</a> &middot; ${MARKETING_POSTAL_ADDRESS}` +
    `</p></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

/**
 * Idempotently add a recipient to the marketing segment. Best-effort: a
 * duplicate is a no-op and NEVER re-subscribes a contact who opted out (we don't
 * pass unsubscribed:false, so Resend leaves an existing contact's consent as-is).
 */
export async function addMarketingContact(
  email: string,
  name?: { firstName?: string; lastName?: string },
): Promise<void> {
  const client = getResend();
  if (!client) throw new Error("RESEND_API_KEY not set");
  const { error } = await client.contacts.create({
    email,
    segments: [{ id: marketingSegmentId() }],
    ...(name ?? {}),
  });
  // Duplicate contact is expected on re-runs; only surface real failures.
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.error(`[marketing] add-contact failed for ${email}:`, error.message);
  }
}

/**
 * Send a marketing blast as a Broadcast to the marketing segment. Resend injects
 * the unsubscribe link, sets the List-Unsubscribe(-Post) headers, and skips
 * already-unsubscribed contacts — so no send-time suppression check is needed on
 * our side. Returns the broadcast id.
 */
export async function sendMarketingBroadcast(params: {
  subject: string;
  html: string;
  from?: string;
}): Promise<{ id: string }> {
  const client = getResend();
  if (!client) throw new Error("RESEND_API_KEY not set");
  const { data: created, error: createErr } = await client.broadcasts.create({
    segmentId: marketingSegmentId(),
    from: params.from ?? FROM,
    subject: params.subject,
    html: withMarketingFooter(params.html),
  });
  if (createErr || !created) throw new Error(`broadcast create failed: ${createErr?.message ?? "unknown"}`);
  const { error: sendErr } = await client.broadcasts.send(created.id);
  if (sendErr) throw new Error(`broadcast send failed: ${sendErr.message}`);
  return { id: created.id };
}
