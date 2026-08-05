/**
 * Inbound failure taxonomy — the "why did inbound not just work" catalog.
 *
 * Every inbound email reaches a terminal state (worker.ts invariant); when that
 * state is a non-ingest, we stamp a STRUCTURED `failure_code` (this enum) plus,
 * where known, the `failure_host` (the portal/secure-delivery domain). Those two
 * columns are PII-free and survive the 30-day sender/subject purge, so the
 * cross-org `inbound_failure_catalog` view (migration 094) can answer, forever:
 * "which portals do we keep failing on?", "how often does OTP relay time out?",
 * "what are customers implicitly asking us to build?".
 *
 * Keep codes STABLE — they are aggregation keys, not copy. The human sentence
 * still lives in `needs_user_reason`/`error`; this is the machine label beside it.
 */

export type FailureCode =
  // ── Deficiencies: things we could fix by building (surface in the roadmap) ──
  /** Secure delivery on a host we can't navigate (unrecognized secure-link host,
   *  or a portal sender we don't fetch). The #1 "go build this portal" signal;
   *  always paired with failure_host. */
  | "portal_unsupported"
  /** A provider/delivery-style announcement with a link we don't auto-fetch in
   *  v1 (known provider "your document is ready", delivery-style message). */
  | "delivery_unfetched"
  /** SafeSend wizard/retrieval failed unexpectedly (navigation broke). */
  | "safesend_nav_failed"
  /** Gave up on a SafeSend link after the attempt budget. */
  | "safesend_exhausted"
  /** Attachment was present but ingestion into the pipeline failed. */
  | "attachment_unreadable"
  /** Unexpected exception while handling the message (code bug / infra). */
  | "handler_exception"
  // ── Environmental / expected: not our bug, excluded from the fix rollup ─────
  /** Waiting for the user to forward the SafeSend access code (feature working). */
  | "otp_awaiting"
  /** Held for review — sender failed DMARC/auth (protective, by design). */
  | "sender_unverified"
  /** Held by a daily volume cap (protective, by design). */
  | "flood_cap_held"
  /** SafeSend link locked (too many attempts upstream) — retry later. */
  | "safesend_locked"
  /** Secure link expired before we could fetch — sender must re-share. */
  | "link_expired"
  /** Delivery was addressed to a different recipient. */
  | "recipient_mismatch";

/**
 * The subset the ops rollup treats as "deficiencies" — failures we can plausibly
 * remove by building something. The rest are environmental (upstream/user/by
 * design) and are kept for volume context but shouldn't read as a bug backlog.
 * Mirrored by the CASE in the migration-094 view; keep the two in sync.
 */
export const DEFICIENCY_CODES: ReadonlySet<FailureCode> = new Set<FailureCode>([
  "portal_unsupported",
  "delivery_unfetched",
  "safesend_nav_failed",
  "safesend_exhausted",
  "attachment_unreadable",
  "handler_exception",
]);

/** The registered hostname of a URL, lowercased, or null if unparseable. Used
 *  to derive failure_host from the offending secure link without retaining the
 *  full (potentially token-bearing) URL. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
