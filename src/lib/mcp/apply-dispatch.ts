/**
 * Single-action dispatch through apply.ts for MCP write tool handlers.
 *
 * Each write tool handler calls `dispatchAction` with its action name + data.
 * This wraps the existing `applyActions` pipeline — no new mutation paths.
 */

import { applyActions, type ApplyResult } from "@/lib/pipeline/apply";
import type { ToolContext } from "./tool-context";
import { ToolError } from "./tool-helpers";

export interface DispatchResult {
  data: unknown;
  audit_event_id?: string;
}

export async function dispatchAction(
  ctx: ToolContext,
  actionName: string,
  data: Record<string, unknown>,
): Promise<DispatchResult> {
  const { results } = await applyActions(
    [{ action: actionName, data }],
    { orgId: ctx.orgId, userId: ctx.userId },
  );

  const r = results[0] as ApplyResult | undefined;
  if (!r || !r.success) {
    throw new ToolError(
      "validation_failed",
      r?.error ?? `${actionName} failed`,
    );
  }

  return {
    data: r.data,
    audit_event_id: (r.data as Record<string, unknown>)?.id as string | undefined,
  };
}
