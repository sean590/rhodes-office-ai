/**
 * Tool-invocation audit logger — writes to `chat_tool_calls`.
 *
 * Every orchestrator tool dispatch (read and write, success and failure) logs
 * a row. Fire-and-forget on the hot path: the audit trail matters but must
 * not block user-facing responses.
 *
 * Write tools additionally gain `staged/applied_at/audit_log_id` lifecycle
 * columns, updated after approval via `markStagedApplied`.
 *
 * Sensitive-field reveals produce a dedicated `audit_log` row (not
 * `chat_tool_calls`) for compliance review — see `logSensitiveReveal`.
 */

import type { ToolContext } from "./tool-context";
import { logAuditEvent } from "@/lib/utils/audit";

export interface ToolCallLogEntry {
  tool_name: string;
  arg_keys: string[];
  kind: "read" | "write";
  ok: boolean;
  error_code?: string;
  error_message?: string;
  duration_ms: number;
  staged?: boolean;
  message_id?: string;
}

/**
 * Fire-and-forget insert into `chat_tool_calls`. Swallows errors so the
 * tool-call result path is never blocked by audit failures.
 */
export function logToolCall(ctx: ToolContext, entry: ToolCallLogEntry): void {
  ctx.supabase
    .from("chat_tool_calls")
    .insert({
      organization_id: ctx.orgId,
      user_id: ctx.userId,
      session_id: ctx.sessionId,
      message_id: entry.message_id ?? null,
      tool_name: entry.tool_name,
      arg_keys: entry.arg_keys,
      kind: entry.kind,
      ok: entry.ok,
      error_code: entry.error_code ?? null,
      error_message: entry.error_message ?? null,
      duration_ms: entry.duration_ms,
      staged: entry.staged ?? false,
    })
    .then(({ error }) => {
      if (error) console.error("[tool-call-log] insert failed:", error.message);
    });
}

/**
 * After apply-actions processes a batch of approved staged writes, mark
 * those `chat_tool_calls` rows as applied with the resulting audit_log ids.
 */
export async function markStagedApplied(
  ctx: ToolContext,
  rows: Array<{ tool_name: string; audit_log_id?: string }>,
): Promise<void> {
  const now = new Date().toISOString();
  for (const row of rows) {
    const { error } = await ctx.supabase
      .from("chat_tool_calls")
      .update({
        applied_at: now,
        audit_log_id: row.audit_log_id ?? null,
      })
      .eq("session_id", ctx.sessionId)
      .eq("tool_name", row.tool_name)
      .eq("staged", true)
      .is("applied_at", null);
    if (error) console.error("[tool-call-log] markStagedApplied failed:", error.message);
  }
}

/**
 * Writes a dedicated `audit_log` row for a sensitive-field reveal (EIN, SSN,
 * bank account, etc.). Queryable separately from mutation audit events for
 * compliance review via `action = 'sensitive_reveal'`.
 */
export async function logSensitiveReveal(
  ctx: ToolContext,
  details: {
    tool_name: string;
    resource_type: string;
    resource_id: string;
    fields_revealed: string[];
  },
): Promise<void> {
  await logAuditEvent({
    userId: ctx.userId,
    action: "sensitive_reveal",
    resourceType: details.resource_type,
    resourceId: details.resource_id,
    organizationId: ctx.orgId,
    metadata: {
      tool_name: details.tool_name,
      fields_revealed: details.fields_revealed,
      session_id: ctx.sessionId,
    },
  });
}
