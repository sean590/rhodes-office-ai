/**
 * Feature kill-switches.
 */

/**
 * Outbound provider sending (secure share links). DISABLED in production
 * 2026-07-28 (Sean): audit H-02 — links are bearer-token only, no recipient
 * verification. Hidden until recipient OTP / verified-recipient delivery is
 * built end-to-end.
 *
 * Env-driven so staging can develop/test the secured version while prod
 * stays dark: `NEXT_PUBLIC_ENABLE_PROVIDER_SENDING=true` is set in Vercel's
 * PREVIEW environment only; unset (= off) in Production and CI. NEXT_PUBLIC_
 * means the value is inlined at BUILD time — changing it requires a redeploy,
 * and client + server always agree.
 *
 * When true, this restores: the providers:send capability (UI buttons,
 * Suggested Sends, send/revoke routes), the send-related MCP tools, and the
 * public /share/[token] page + download endpoint.
 */
export const PROVIDER_SENDING_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_PROVIDER_SENDING === "true";
