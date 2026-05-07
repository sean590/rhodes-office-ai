/**
 * Apply adapter — processes approved staged write actions.
 *
 * Takes a batch of StagedAction objects (from the approval card) plus a ctx,
 * dispatches each through its write tool's full handler in order. Continues
 * on failure: if one action fails (e.g., the entity was deleted between
 * staging and apply), the others still apply. This matches the legacy
 * apply-actions behavior.
 */

import type { ToolContext } from "./tool-context";
import type { StagedAction } from "./staging";
import type { ToolDefinition } from "./schema";
import { buildToolRegistry } from "./server";

export interface ApplyResult {
  applied: Array<{
    action: StagedAction;
    data: unknown;
    audit_event_id?: string;
  }>;
  failed: Array<{
    action: StagedAction;
    error: string;
  }>;
}

/**
 * Dispatch each staged action through its tool's handler. Continue-on-failure
 * by default: a failed action doesn't halt the batch.
 */
export async function applyMcpActions(
  ctx: ToolContext,
  actions: StagedAction[],
): Promise<ApplyResult> {
  const registry = buildToolRegistry();
  const toolMap = new Map<string, ToolDefinition>(
    registry.map((t) => [t.name, t]),
  );

  const applied: ApplyResult["applied"] = [];
  const failed: ApplyResult["failed"] = [];

  for (const action of actions) {
    const tool = toolMap.get(action.tool);
    if (!tool) {
      failed.push({ action, error: `tool "${action.tool}" not found` });
      continue;
    }
    if (tool.kind !== "write") {
      failed.push({ action, error: `tool "${action.tool}" is not a write tool` });
      continue;
    }

    try {
      const parsed = tool.inputSchema.parse(action.input);
      const result = await tool.handler(parsed, ctx);
      applied.push({
        action,
        data: (result as { data: unknown }).data,
        audit_event_id: (result as { audit_event_id?: string }).audit_event_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ action, error: message });
    }
  }

  return { applied, failed };
}
