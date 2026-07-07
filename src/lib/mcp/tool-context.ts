/**
 * Per-turn tool context. Constructed once per chat turn from the authenticated
 * session. Tool handlers receive this as their first argument and must use
 * `ctx.orgId` as a hard filter on every DB query — `organization_id` is
 * NEVER taken from tool arguments.
 *
 * Architectural guarantee: cross-org access is impossible, not merely filtered.
 *
 * See `rhodes-mcp-tool-architecture-spec.md` → Security Model → Authorization
 * pattern.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import type { OrgRole } from "@/lib/types/enums";
import { redact as redactImpl, type RedactOptions } from "./redact";

export interface ToolContext {
  userId: string;
  orgId: string;
  /** Caller's role — write tools are gated against this (RBAC parity with the
   *  REST routes; CLAUDE.md rule #2). See orchestrator dispatch + apply-adapter. */
  orgRole: OrgRole;
  sessionId: string;
  supabase: SupabaseClient;
  redact: <T>(obj: T, options?: RedactOptions) => T;
}

export type BuildToolContextResult =
  | { ok: true; ctx: ToolContext }
  | { ok: false; response: Response };

/**
 * Build the tool context from the current Supabase session.
 *
 * Returns the context on success, or a pre-baked Response (401/403) that the
 * caller route handler should return directly — matches the `requireOrg`
 * pattern used across the app.
 */
export async function buildToolContext(sessionId: string): Promise<BuildToolContextResult> {
  const org = await requireOrg();
  if (isError(org)) return { ok: false, response: org };

  const ctx: ToolContext = {
    userId: org.user.id,
    orgId: org.orgId,
    orgRole: org.user.orgRole,
    sessionId,
    supabase: createAdminClient(),
    redact: redactImpl,
  };
  return { ok: true, ctx };
}
