/**
 * friendlyProcessingError — turn a raw pipeline failure string into safe, human
 * copy for the Processing surface (and anywhere a stuck document's error is
 * shown). Raw extraction errors can embed signed storage URLs, queue/split
 * paths, org ids, and request ids — none of which may ever reach a user (the
 * "no raw UUID" rule). This maps the known failure shapes to friendly copy and,
 * for anything unrecognized, strips URLs / UUIDs / JSON blobs before showing it.
 *
 * Idempotent: running it on already-friendly text returns that text unchanged,
 * so it's safe to apply at both the worker (storage) and render layers.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const URL_RE = /https?:\/\/\S+/g;
const JSON_BLOB_RE = /\{[^{}]*\}/g;

export function friendlyProcessingError(raw: string | null | undefined): string {
  const generic = "Something went wrong reading this document. Retry?";
  if (!raw) return generic;
  const s = String(raw).trim();
  const lower = s.toLowerCase();

  if (/rate.?limit|rate_limit|\b429\b|too many requests|overloaded/.test(lower)) {
    return "Hit the AI rate limit — this usually clears in a minute. Retry?";
  }
  if (/too large|too long|too many tokens|prompt is too long/.test(lower)) {
    // Preserve the worker's richer page-count message when present.
    return s.startsWith("This document is too large")
      ? s
      : "This document is too large to process. Try uploading individual sections.";
  }
  if (/failed to (download|upload)|download file|object not found|storage/.test(lower) || /https?:\/\//.test(s)) {
    return "Couldn't access the source file — it may have been moved. Retry?";
  }
  if (/password|encrypted|decrypt/.test(lower)) {
    return "This document is password-protected.";
  }

  // Unknown error — never echo raw infrastructure detail. Strip URLs, UUIDs,
  // and JSON blobs; only show what's left if it reads like a plain sentence.
  const cleaned = s
    .replace(URL_RE, "")
    .replace(UUID_RE, "")
    .replace(JSON_BLOB_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 4 || /[{}":]|https?:\/\//.test(cleaned)) return generic;
  return cleaned;
}
