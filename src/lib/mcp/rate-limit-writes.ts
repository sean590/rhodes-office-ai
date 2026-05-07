/**
 * MCP write-tool rate limits — per-turn and per-hour caps.
 *
 * Both stack on Phase 1's total-tool-calls-per-turn cap (10). The write caps
 * are lower because writes are inherently higher-risk: one bad batch
 * reverberates through audit, compliance, and real dollar figures.
 *
 * Uses the same Upstash Redis infrastructure as the existing chat + pipeline
 * rate limiters. Falls back to allowing when Redis is unavailable — matches
 * the existing pattern.
 */

import { rateLimit } from "@/lib/utils/rate-limit";
import { ToolError } from "./tool-helpers";

export const MAX_WRITES_PER_TURN = 20;
export const MAX_WRITES_PER_HOUR = 50;

/**
 * Synchronous per-turn check. No external call — just compares the staged
 * count against the cap. Call BEFORE appending to the staged-actions array.
 *
 * The thrown error becomes a tool-result string Claude sees on its next
 * iteration. Phrasing matters: a plain "rate limited" string was historically
 * misread as a recoverable per-tool error and Claude would silently stop
 * trying without telling the user. The directive prefix + explicit next-step
 * instructions push it toward summarizing what's been staged and asking the
 * user to approve before continuing.
 */
export function checkPerTurnWriteCap(stagedCount: number): void {
  if (stagedCount >= MAX_WRITES_PER_TURN) {
    throw new ToolError(
      "rate_limited",
      `[RATE_LIMITED] You've reached the per-turn write cap of ${MAX_WRITES_PER_TURN} staged actions. STOP calling write tools immediately. Tell the user exactly what you've staged so far and ask them to approve or skip those before you continue with the rest of the plan. After approval, the next turn will reset the cap.`,
    );
  }
}

/**
 * Async per-hour check. Hits Upstash sliding window keyed on the user id.
 * Called per-action by /api/chat/apply-actions — only applied writes count
 * toward the bucket. (Was previously called at stage time in the orchestrator,
 * which meant skipped/discarded stages also burned the budget.)
 */
export async function checkPerHourWriteCap(userId: string): Promise<void> {
  const allowed = await rateLimit(`mcp_writes:${userId}`, MAX_WRITES_PER_HOUR, 3600_000);
  if (!allowed) {
    throw new ToolError(
      "rate_limited",
      `per-hour write cap reached (${MAX_WRITES_PER_HOUR}/hour)`,
    );
  }
}
