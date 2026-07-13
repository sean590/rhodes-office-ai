/**
 * Queue-item lifecycle MCP tools.
 *
 * Closes the alignment gap between chat and the /review API surface: the
 * pipeline routes (/api/pipeline/queue/[itemId]/{approve,reject}) used to
 * have no chat-callable equivalent, so the chat agent could fix the
 * underlying state but couldn't mark a queue item resolved. These tools fix
 * that — chat can do everything /review can.
 *
 * Both tools delegate to `src/lib/pipeline/queue-actions.ts` so the same
 * primitives execute regardless of which surface called them.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { ToolError } from "../tool-helpers";
import { fileQueueItem, rejectQueueItem } from "@/lib/pipeline/queue-actions";

export const fileQueueItemTool = defineTool({
  name: "file_queue_item",
  description:
    "Mark a document-queue item as approved/filed once the document agent's " +
    "linkage decisions look right. Use this after verifying that the right " +
    "entity, investment, and transaction are attached. The agent's writes " +
    "(link_document_to_entity, link_document_to_investment, " +
    "update_investment_transaction) are not undone — this only flips the " +
    "queue item out of /review and surfaces the document in the user's " +
    "filing views. Refuses if the item isn't currently in review_ready or " +
    "extracted state.",
  kind: "write",
  inputSchema: z.object({
    queue_item_id: z.string().uuid(),
  }),
  dryRun: async ({ queue_item_id }, ctx) => {
    const { data: item } = await ctx.supabase
      .from("document_queue")
      .select("original_filename, ai_suggested_name, status")
      .eq("id", queue_item_id)
      .maybeSingle();
    const name = (item as { original_filename?: string; ai_suggested_name?: string } | null);
    const display = name?.ai_suggested_name || name?.original_filename || "queue item";
    return { summary: `File "${display}" (mark approved)` };
  },
  handler: async ({ queue_item_id }, ctx) => {
    const result = await fileQueueItem(queue_item_id, {
      orgId: ctx.orgId,
      userId: ctx.userId || null,
    });
    if (!result.ok) {
      throw new ToolError(
        result.status === 404 ? "not_found" : "validation_failed",
        result.error,
      );
    }
    return {
      data: {
        queue_item_id: result.item?.id ?? queue_item_id,
        document_id: result.documentId,
        status: "approved" as const,
        // Benign no-op: the item was already filed or no longer in the queue.
        ...(result.noop ? { already_filed: true } : {}),
      },
    };
  },
});

export const rejectQueueItemTool = defineTool({
  name: "reject_queue_item",
  description:
    "Mark a document-queue item as rejected. Use when the user decides the " +
    "document shouldn't be filed under the agent's proposal — the agent's " +
    "actual link/update writes are NOT rolled back. If the user wants those " +
    "reversed, the agent should also call unlink_document or " +
    "update_investment_transaction with the reverse change. Optional reason " +
    "is recorded on the queue item and the audit log.",
  kind: "write",
  inputSchema: z.object({
    queue_item_id: z.string().uuid(),
    reason: z
      .string()
      .optional()
      .nullable()
      .describe("One-line note saved as the queue item's extraction_error and to audit metadata."),
  }),
  dryRun: async ({ queue_item_id, reason }, ctx) => {
    const { data: item } = await ctx.supabase
      .from("document_queue")
      .select("original_filename, ai_suggested_name")
      .eq("id", queue_item_id)
      .maybeSingle();
    const name = (item as { original_filename?: string; ai_suggested_name?: string } | null);
    const display = name?.ai_suggested_name || name?.original_filename || "queue item";
    return {
      summary: reason
        ? `Reject "${display}" (${reason})`
        : `Reject "${display}"`,
    };
  },
  handler: async ({ queue_item_id, reason }, ctx) => {
    const result = await rejectQueueItem(
      queue_item_id,
      { orgId: ctx.orgId, userId: ctx.userId || null },
      reason,
    );
    if (!result.ok) {
      throw new ToolError(
        result.status === 404 ? "not_found" : "validation_failed",
        result.error,
      );
    }
    return {
      data: {
        queue_item_id: result.item.id,
        status: "rejected" as const,
        reason: reason ?? null,
      },
    };
  },
});

export const queueWriteTools: ToolDefinition[] = [
  fileQueueItemTool,
  rejectQueueItemTool,
];
