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
