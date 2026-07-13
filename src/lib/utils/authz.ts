import { NextResponse } from "next/server";
import { requireOrg, isError, type OrgContext } from "@/lib/utils/org-context";
import { can, type Capability } from "@/lib/authz/policy";

/**
 * Server-side RBAC guards for API routes.
 *
 * Mirrors `requireOrg()`'s ergonomics exactly — returns `OrgContext | NextResponse`
 * (never throws), so the call-site pattern is identical:
 *
 *   const ctx = await requireCapability("records:delete");
 *   if (isError(ctx)) return ctx;
 *   // ...ctx.orgId / ctx.user.orgRole available, role already checked
 *
 * This is the SECURITY BOUNDARY. Routes use the service-role admin client (which
 * bypasses RLS), and the UI gating is cosmetic — so the role check MUST happen
 * here. Reads and normal member writes stay on `requireOrg()` (any member); these
 * guards are for the privileged/destructive operations (delete, provider send,
 * team/org management).
 */

/** Require the caller's role to hold `cap`. 403 otherwise. */
export async function requireCapability(
  cap: Capability
): Promise<OrgContext | NextResponse> {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  if (!can(ctx.user.orgRole, cap)) {
    return NextResponse.json(
      { error: "Insufficient permissions", code: "forbidden" },
      { status: 403 }
    );
  }
  return ctx;
}

// Convenience aliases for the common privileged gates — greppable + intent-revealing.
/** Delete a top-level / financial record (admin+). */
export const requireDelete = () => requireCapability("records:delete");
/** Send documents out to a provider (admin+). */
export const requireProviderSend = () => requireCapability("providers:send");
/** Manage team members / invites / roles (admin+). */
export const requireMemberManage = () => requireCapability("members:manage");
/** Edit org settings (admin+). */
export const requireOrgSettings = () => requireCapability("org:settings");
