import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { ingestQueueItem } from "@/lib/pipeline/ingest";
import { applyActions } from "@/lib/pipeline/apply";
import type { ChatProposedAction } from "@/lib/types/chat";

/**
 * POST /api/chat/apply-actions
 *
 * Executes approved actions from a chat message's proposed actions.
 * Updates the message metadata with applied/failed statuses.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const admin = createAdminClient();
    const body = await request.json();
    const { message_id, approved_action_ids, skip_all } = body;

    if (!message_id) {
      return NextResponse.json({ error: "message_id is required" }, { status: 400 });
    }

    // Fetch the chat message
    const { data: message, error: msgError } = await admin
      .from("chat_messages")
      .select("*")
      .eq("id", message_id)
      .single();

    if (msgError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const metadata = (message.metadata || {}) as Record<string, unknown>;
    const proposedActions = (metadata.proposed_actions || []) as ChatProposedAction[];
    const attachments = (metadata.attachments || []) as Array<Record<string, unknown>>;

    if (skip_all) {
      // Mark all pending actions as rejected
      const updatedActions = proposedActions.map((a) => ({
        ...a,
        status: a.status === "pending" ? "rejected" : a.status,
      }));

      await admin.from("chat_messages").update({
        metadata: { ...metadata, proposed_actions: updatedActions },
      }).eq("id", message_id);

      // Ingest all review-ready items without applying actions
      const skipQueueItemIds = [...new Set(attachments.map((a) => a.queue_item_id as string).filter(Boolean))];
      const { data: skipItems } = await admin.from("document_queue").select("*").in("id", skipQueueItemIds);
      for (const item of skipItems || []) {
        try {
          await ingestQueueItem({ item: item as Record<string, unknown>, userId: user.id, orgId, applyMutations: false, finalStatus: "approved" });
        } catch (err) {
          console.error(`Ingest-only failed for ${item.id}:`, err);
        }
      }

      return NextResponse.json({ applied: 0, skipped: proposedActions.length });
    }

    if (!Array.isArray(approved_action_ids) || approved_action_ids.length === 0) {
      return NextResponse.json({ error: "approved_action_ids is required" }, { status: 400 });
    }

    const approvedSet = new Set(approved_action_ids);

    // Group approved actions by queue_item_id
    const actionsByItem = new Map<string, ChatProposedAction[]>();
    for (const action of proposedActions) {
      if (approvedSet.has(action.id)) {
        const existing = actionsByItem.get(action.queue_item_id) || [];
        existing.push(action);
        actionsByItem.set(action.queue_item_id, existing);
      }
    }

    // Process each queue item that has approved actions
    let applied = 0;
    let failed = 0;
    const results: Array<{ action_id: string; status: string; error?: string }> = [];

    // Fetch all queue items we need to process
    const allQueueItemIds = [...new Set(attachments.map((a) => a.queue_item_id as string).filter(Boolean))];
    const { data: queueItems } = await admin
      .from("document_queue")
      .select("*")
      .in("id", allQueueItemIds);
    const queueItemMap = new Map((queueItems || []).map((q: Record<string, unknown>) => [q.id as string, q]));

    // Step 1: Ingest documents first (create document records, no mutations)
    // This ensures we have document_ids for linking
    const documentIdMap = new Map<string, string>(); // queue_item_id → document_id
    for (const itemId of allQueueItemIds) {
      const item = queueItemMap.get(itemId);
      if (!item) continue;
      if (item.document_id) {
        documentIdMap.set(itemId, item.document_id as string);
        continue;
      }
      try {
        const result = await ingestQueueItem({ item, userId: user.id, orgId, applyMutations: false, finalStatus: "approved" });
        if (result?.document?.id) {
          documentIdMap.set(itemId, result.document.id as string);
        }
      } catch (err) {
        console.error(`Ingest failed for ${itemId}:`, err);
      }
    }

    // Step 2: Apply approved actions with document context.
    //
    // For batches that mix multiple uploaded PDFs, each action gets its OWN
    // document_id via the per-action enrichment below. apply.ts honors
    // item.data.document_id before falling back to options.documentId, so
    // we no longer need (or want) to compute a single batch-level documentId
    // — that previously caused every action in a multi-PDF batch to be
    // mis-attributed to whichever PDF happened to be first in the list.
    //
    // existingEntityId is still picked from the first item because it's a
    // suggestion for the apply handler when it can't resolve an entity from
    // the action data — that's a different concern from document linkage.
    const approvedActions = proposedActions.filter((a) => approvedSet.has(a.id));
    const firstQueueItemId = approvedActions[0]?.queue_item_id;
    const firstItem = firstQueueItemId ? queueItemMap.get(firstQueueItemId) : null;

    try {
      // Enrich each action with its OWN document_id (and queue_item_id) so
      // apply.ts can resolve per-action document linkage.
      const enrichedActions = approvedActions.map((a) => {
        const data = { ...(a.data as Record<string, unknown>) };
        if (a.queue_item_id && !data.document_id) {
          const docId = documentIdMap.get(a.queue_item_id);
          if (docId) data.document_id = docId;
          data.queue_item_id = a.queue_item_id;
        }
        return { action: a.action, data };
      });

      const { results: applyResults } = await applyActions(
        enrichedActions,
        {
          orgId,
          existingEntityId: firstItem?.ai_entity_id as string || firstItem?.staged_entity_id as string || undefined,
          // documentId intentionally undefined — apply.ts now reads each
          // action's own data.document_id.
        }
      );

      for (let i = 0; i < approvedActions.length; i++) {
        const result = applyResults[i];
        if (result?.success) {
          results.push({ action_id: approvedActions[i].id, status: "applied" });
          applied++;
        } else {
          results.push({ action_id: approvedActions[i].id, status: "failed", error: result?.error || "Unknown error" });
          failed++;
        }
      }
    } catch (err) {
      console.error("Apply actions failed:", err);
      for (const action of approvedActions) {
        results.push({ action_id: action.id, status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
        failed++;
      }
    }

    // Update message metadata with new statuses. Persist the per-action
    // error string so the chat approval card can surface it inline — without
    // this, "✗ Failed" badges appeared with no way to see why short of
    // opening devtools.
    const updatedActions = proposedActions.map((a) => {
      if (approvedSet.has(a.id)) {
        const result = results.find((r) => r.action_id === a.id);
        if (result?.status === "applied") {
          return { ...a, status: "applied" as const, error: undefined };
        }
        return {
          ...a,
          status: "failed" as const,
          error: result?.error || "Unknown error",
        };
      }
      // Non-approved actions stay pending or get rejected
      return { ...a, status: a.status === "pending" ? "rejected" : a.status };
    });

    await admin.from("chat_messages").update({
      metadata: { ...metadata, proposed_actions: updatedActions, processing_status: "completed" },
    }).eq("id", message_id);

    // Also ingest-only any queue items that had no approved actions
    const processedItemIds = new Set(actionsByItem.keys());
    for (const itemId of allQueueItemIds) {
      if (!processedItemIds.has(itemId)) {
        const item = queueItemMap.get(itemId);
        if (!item) continue;
        try {
          await ingestQueueItem({ item, userId: user.id, orgId, applyMutations: false, finalStatus: "approved" });
        } catch (err) {
          console.error(`Ingest-only failed for ${itemId}:`, err);
        }
      }
    }

    // Generate follow-up message based on what was applied
    let followUp = "";
    const appliedTypes = new Set(approvedActions.filter((_, i) => results[i]?.status === "applied").map(a => a.action));

    if (appliedTypes.has("create_investment")) {
      followUp = "I've created the investment record. A few more things would help me track this properly — how much was invested, when was the investment made, and are there any co-investors or a specific ownership percentage?";
    } else if (appliedTypes.has("create_entity")) {
      followUp = "The entity has been created. Would you like me to add any members, managers, or set up compliance tracking for it?";
    } else if (appliedTypes.has("record_investment_transaction")) {
      followUp = "Transaction recorded. Would you like to set up member allocations for how this amount is split internally?";
    }

    return NextResponse.json({ applied, failed, results, follow_up: followUp || undefined });
  } catch (err) {
    console.error("POST /api/chat/apply-actions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
