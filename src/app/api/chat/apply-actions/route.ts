/**
 * POST /api/chat/apply-actions
 *
 * Executes approved staged write actions from the MCP chat approval card.
 * Each action is dispatched through its write tool's handler via apply-adapter,
 * which converges on the shared apply.ts mutation pipeline.
 *
 * Legacy JSON-action-block format removed in Phase 3-4 cutover.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { applyMcpActions } from "@/lib/mcp/apply-adapter";
import { markStagedApplied } from "@/lib/mcp/tool-call-log";
import { redact } from "@/lib/mcp/redact";
import { checkPerHourWriteCap } from "@/lib/mcp/rate-limit-writes";
import { ToolError } from "@/lib/mcp/tool-helpers";
import type { StagedAction } from "@/lib/mcp/staging";

// Applying a large approval batch (e.g. 20+ actions) takes real time even
// parallelized; without a budget the route hit the default timeout and failed.
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const admin = createAdminClient();
    const body = await request.json();

    if (!Array.isArray(body.actions) || body.actions.length === 0) {
      return NextResponse.json({ error: "actions array is required" }, { status: 400 });
    }
    const sessionId = body.session_id as string;
    if (!sessionId) {
      return NextResponse.json({ error: "session_id is required" }, { status: 400 });
    }

    const mcpCtx = {
      userId: user.id,
      orgId,
      orgRole: user.orgRole,
      sessionId,
      supabase: admin,
      redact,
    };

    // Per-hour write cap (formerly enforced at stage time in the
    // orchestrator). Pre-check each action sequentially: bucket increments
    // on each call, so the first N that fit pass and the (N+1)th onwards
    // surface as rate_limited failures without ever reaching the apply
    // pipeline. Skipped stages never count any more — only the actions a
    // user explicitly approves burn the bucket.
    const requestedActions = body.actions as StagedAction[];
    const allowedActions: StagedAction[] = [];
    const rateLimitedActions: StagedAction[] = [];
    for (const action of requestedActions) {
      try {
        await checkPerHourWriteCap(user.id);
        allowedActions.push(action);
      } catch (e) {
        if (e instanceof ToolError && e.code === "rate_limited") {
          rateLimitedActions.push(action);
        } else {
          throw e;
        }
      }
    }

    const result = await applyMcpActions(mcpCtx, allowedActions);

    // Synthesize a "failed" entry for each rate-limited action so the chat
    // UI surfaces them the same way it surfaces validation/apply failures.
    if (rateLimitedActions.length > 0) {
      const rateLimitMsg =
        "Hourly write limit reached (50/hour). Wait an hour, or ask an admin to bump MAX_WRITES_PER_HOUR.";
      for (const action of rateLimitedActions) {
        result.failed.push({ action, error: rateLimitMsg });
      }
    }

    if (result.applied.length > 0) {
      await markStagedApplied(
        mcpCtx,
        result.applied.map((a) => ({
          tool_name: a.action.tool,
          audit_log_id: a.audit_event_id,
        })),
      );
    }

    // Synthetic applied-message — role: "user" so it enters the conversation
    // thread as context for Claude's next turn without polluting the assistant
    // turn sequence.
    const appliedSummary = result.applied
      .map((a) => a.action.summary)
      .join(", ");
    const failedSummary = result.failed
      .map((f) => `${f.action.summary}: ${f.error}`)
      .join("; ");
    const syntheticContent = [
      result.applied.length > 0 ? `[applied: ${appliedSummary}]` : "",
      result.failed.length > 0 ? `[failed: ${failedSummary}]` : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (syntheticContent) {
      await admin.from("chat_messages").insert({
        session_id: sessionId,
        role: "user",
        content: syntheticContent,
        metadata: {
          synthetic: true,
          applied_actions: result.applied.map((a) => ({
            tool: a.action.tool,
            summary: a.action.summary,
          })),
          failed_actions: result.failed.map((f) => ({
            tool: f.action.tool,
            summary: f.action.summary,
            error: f.error,
          })),
        },
      });
    }

    // Generate a follow_up hint so the chat drawer's auto-continuation
    // path fires after approval. Specific high-value cases get richer
    // prompts; everything else gets a neutral "continue if there's more,
    // otherwise summarize" fallback. The fallback exists because plans
    // outlined as multiple phases (e.g. "Round 1: add investors, Round 2:
    // book transactions, Round 3: delete originals") only set staged
    // actions for Round 1 and rely on a follow-up turn to do the rest —
    // without a follow_up the user has to manually nudge Claude to
    // continue.
    let follow_up: string | undefined;
    const appliedTools = result.applied.map((a) => a.action.tool);
    if (appliedTools.includes("create_compliance_obligation")) {
      follow_up =
        "The obligations were just created. Check if any should be marked as complete based on the documents that were just linked.";
    } else if (
      appliedTools.includes("link_document_to_entity") &&
      appliedTools.length >= 2
    ) {
      follow_up =
        "Documents were linked. Check if any compliance obligations should be created or updated based on the linked documents.";
    } else if (result.applied.length > 0) {
      follow_up =
        "The staged actions were applied. If your plan had additional phases (e.g. you outlined multiple rounds of approvals), continue with the next phase now. Otherwise summarize what's been done in one or two sentences.";
    }

    return NextResponse.json({
      applied: result.applied.length,
      failed: result.failed.length,
      results: [
        ...result.applied.map((a) => ({
          tool: a.action.tool,
          status: "applied" as const,
        })),
        ...result.failed.map((f) => ({
          tool: f.action.tool,
          status: "failed" as const,
          error: f.error,
        })),
      ],
      follow_up,
    });
  } catch (err) {
    console.error("POST /api/chat/apply-actions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
