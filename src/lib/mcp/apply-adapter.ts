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

  type Outcome =
    | { applied: ApplyResult["applied"][number] }
    | { failed: ApplyResult["failed"][number] };

  const applyOne = async (action: StagedAction): Promise<Outcome> => {
    const tool = toolMap.get(action.tool);
    if (!tool) return { failed: { action, error: `tool "${action.tool}" not found` } };
    if (tool.kind !== "write") {
      return { failed: { action, error: `tool "${action.tool}" is not a write tool` } };
    }
    const t0 = Date.now();
    try {
      const parsed = tool.inputSchema.parse(action.input);
      const result = await tool.handler(parsed, ctx);
      console.log(`[apply] ${action.tool} ${Date.now() - t0}ms`);
      return {
        applied: {
          action,
          data: (result as { data: unknown }).data,
          audit_event_id: (result as { audit_event_id?: string }).audit_event_id,
        },
      };
    } catch (err) {
      console.log(`[apply] ${action.tool} FAILED ${Date.now() - t0}ms: ${err instanceof Error ? err.message : String(err)}`);
      return { failed: { action, error: err instanceof Error ? err.message : String(err) } };
    }
  };

  // Apply in bounded-concurrency chunks rather than one-at-a-time: a 20-action
  // batch applied serially took minutes and timed the route out. Within a
  // single approval batch the actions are independent — the agent can't stage
  // an action against a resource it's creating in the same batch (it wouldn't
  // have the id), so cross-resource dependencies span follow-up turns. Order
  // within applied/failed is preserved; continue-on-failure is unchanged.
  const CONCURRENCY = 5;
  const applied: ApplyResult["applied"] = [];
  const failed: ApplyResult["failed"] = [];
  for (let i = 0; i < actions.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(actions.slice(i, i + CONCURRENCY).map(applyOne));
    for (const o of outcomes) {
      if ("applied" in o) applied.push(o.applied);
      else failed.push(o.failed);
    }
  }

  return { applied, failed };
}
