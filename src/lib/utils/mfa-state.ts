/**
 * The `rhodes_mfa_state` cookie — a login-set signal that lets middleware enforce
 * MFA (redirect an enrolled-but-unchallenged session to /auth/mfa, and a
 * past-grace unenrolled user to /settings/security) WITHOUT a per-request
 * listFactors round-trip on the hot path.
 *
 * The cookie tracks ENROLLMENT + grace deadline. It does NOT track the current
 * assurance level — that lives in the session JWT's `aal` claim, which flips to
 * aal2 the moment the challenge is completed (no re-login), so a login-set
 * cookie can't represent it. Middleware combines the two: cookie says "enrolled"
 * + JWT says "aal1" → step up.
 *
 * Values:
 *   "enrolled"    — user has ≥1 verified MFA factor.
 *   "grace:<ms>"  — not enrolled; must enroll by this epoch-ms deadline.
 *   "exempt"      — not enrolled and no grace deadline set → don't enforce.
 *
 * This is a UX/redirect optimization; the real boundary is the server-side
 * requireAal2 on sensitive routes. The cookie may be ABSENT (sessions predating
 * rollout) — middleware treats absent as "don't redirect" and lets the client
 * MfaGate backstop, so shipping this never locks anyone out of an active session.
 */
export const MFA_STATE_COOKIE = "rhodes_mfa_state";

export function buildMfaStateValue(
  hasVerifiedFactor: boolean,
  graceUntilIso: string | null,
): string {
  if (hasVerifiedFactor) return "enrolled";
  if (!graceUntilIso) return "exempt";
  const ms = new Date(graceUntilIso).getTime();
  return Number.isFinite(ms) ? `grace:${ms}` : "exempt";
}

export function mfaStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24, // 24h; refreshed at login and on enroll/unenroll
  };
}
