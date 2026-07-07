import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/utils/authz";
import { isError, type OrgContext } from "@/lib/utils/org-context";
import type { Capability } from "@/lib/authz/policy";

/**
 * MFA / Authenticator Assurance Level helpers (Phase 2, Increment 3).
 *
 * aal1 = password/OAuth only; aal2 = an MFA challenge was completed this session.
 * These are the SERVER-SIDE enforcement for sensitive actions. The client
 * redirect to /auth/mfa (see the layout MfaGate) is UX only.
 */

export type Aal = "aal1" | "aal2";

/** Current assurance level of the caller's session. */
export async function getSessionAal(): Promise<Aal> {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal2" ? "aal2" : "aal1";
}

/** True if the caller has at least one VERIFIED MFA factor (TOTP or phone). */
export async function hasVerifiedFactor(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const totp = (data?.totp ?? []).some((f) => f.status === "verified");
  const phone = (data?.phone ?? []).some((f) => f.status === "verified");
  return totp || phone;
}

/**
 * Returns null if the caller is at aal2, otherwise a 403 telling the client what
 * to do next:
 *  - enrolled but not challenged this session → `step_up_required` (prompt a challenge)
 *  - not enrolled at all → `mfa_enrollment_required` (send them to enroll)
 * The distinct `code` lets the client wrapper decide (challenge modal vs enroll
 * redirect) and keeps SessionGuard from treating it as a logout (it only acts on 401).
 */
export async function requireAal2(): Promise<NextResponse | null> {
  if ((await getSessionAal()) === "aal2") return null;
  const enrolled = await hasVerifiedFactor();
  return NextResponse.json(
    enrolled
      ? { error: "This action requires a fresh security check.", code: "step_up_required" }
      : {
          error: "Enroll multi-factor authentication to perform this action.",
          code: "mfa_enrollment_required",
        },
    { status: 403 },
  );
}

/**
 * Combined gate for a SENSITIVE action: RBAC capability (role) AND a completed
 * MFA challenge (aal2). Returns the OrgContext on success, or a NextResponse
 * (403 role / 403 step-up) to return directly. Wire this onto the same routes
 * as the RBAC guards once enrollment enforcement is live (Increment 3, chunk 2).
 */
export async function requireSensitive(
  cap: Capability
): Promise<OrgContext | NextResponse> {
  const ctx = await requireCapability(cap);
  if (isError(ctx)) return ctx;
  const stepUp = await requireAal2();
  if (stepUp) return stepUp;
  return ctx;
}
