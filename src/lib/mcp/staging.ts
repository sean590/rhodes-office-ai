/**
 * Staging buffer for MCP write tools.
 *
 * When the orchestrator encounters a `tool_use` block for a write-kind tool,
 * it does NOT call the handler. Instead it calls `stageAction`, which:
 *   1. Runs the tool's `dryRun(input, ctx)` — ownership checks, Zod
 *      validation, context fetches, but NO mutation.
 *   2. If dryRun succeeds, returns a `StagedAction` carrying a human-readable
 *      summary + preview. The orchestrator appends this to its per-turn
 *      staged list and hands Claude a `{ staged: true, summary }` tool_result.
 *   3. If dryRun throws a `ToolError`, the error propagates so the
 *      orchestrator returns it to Claude (who can retry or ask the user).
 *
 * The full handler runs only later, inside `/api/chat/apply-actions`, when
 * the user clicks Approve on the approval card.
 */

import { randomUUID } from "crypto";
import type { ToolContext } from "./tool-context";

export interface StagedAction {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  resource_preview?: unknown;
}

export interface DryRunResult {
  summary: string;
  preview?: unknown;
}

export type DryRunFn = (
  input: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<DryRunResult>;

/**
 * Stage a write-tool invocation. Calls the tool's `dryRun` to produce a
 * human-readable summary for the approval card. Throws on validation or
 * ownership failure — the caller should surface the error to Claude.
 */
export async function stageAction(
  ctx: ToolContext,
  toolName: string,
  input: Record<string, unknown>,
  dryRun: DryRunFn,
): Promise<StagedAction> {
  const { summary, preview } = await dryRun(input, ctx);
  return {
    id: randomUUID(),
    tool: toolName,
    input,
    summary,
    resource_preview: preview,
  };
}
