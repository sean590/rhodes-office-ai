/**
 * Feature kill-switches — code constants, not env vars, so every environment
 * behaves identically and re-enabling is a one-line reviewed PR.
 */

/**
 * Outbound provider sending (secure share links). DISABLED 2026-07-28 (Sean):
 * audit H-02 — links are bearer-token only, no recipient verification. Hidden
 * until recipient OTP / verified-recipient delivery is built end-to-end.
 * Flipping this back on restores: the providers:send capability (UI buttons,
 * Suggested Sends, send/revoke routes), the send-related MCP tools, and the
 * public /share/[token] page + download endpoint.
 */
export const PROVIDER_SENDING_ENABLED = false;
