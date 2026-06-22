/**
 * Pipeline worker — processes document queue items with concurrency control.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { PdfPasswordRequiredError } from "./pdf-processor";
import { assertNoDbError, logDbError } from "./db-errors";
import * as Sentry from "@sentry/nextjs";
import Anthropic from "@anthropic-ai/sdk";
import {
  runOrchestratorStreaming,
  type AnthropicClientLike,
  type OrchestratorMessage,
} from "@/lib/mcp/orchestrator";
import { redact } from "@/lib/mcp/redact";
import { friendlyProcessingError } from "@/lib/pipeline/error-copy";

/**
 * Process a single queue item via the document agent. The agent is the
 * single source of truth for what gets identified, linked, and recorded —
 * the worker just shuttles the file in and reflects the outcome onto the
 * queue item's row. No batch-level state is threaded through; the agent
 * fetches what it needs via tool calls (same handlers chat uses).
 */
export async function processQueueItem(
  itemId: string,
  options?: { password?: string },
): Promise<void> {
  const admin = createAdminClient();

  // 1. Fetch queue item (include batch org ID)
  const { data: item, error: itemError } = await admin
    .from("document_queue")
    .select("*, document_batches!fk_queue_batch(entity_discovery, organization_id, entity_id, user_context, created_by)")
    .eq("id", itemId)
    .single();

  if (itemError || !item) {
    console.error(`Queue item ${itemId} not found:`, itemError);
    return;
  }

  // Helper to update processing progress (best-effort UI signal).
  const updateProgress = async (step: string, progress: number) => {
    const { error } = await admin.from("document_queue").update({
      processing_step: step,
      processing_progress: progress,
      updated_at: new Date().toISOString(),
    }).eq("id", itemId);
    logDbError(error, `${itemId}: update progress to ${step}`);
  };

  // 2. Update status to extracting (invariant — drives the state machine).
  {
    const { error } = await admin
      .from("document_queue")
      .update({
        status: "extracting",
        extraction_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    assertNoDbError(error, `${itemId}: mark extracting`);
  }

  try {
    // 3. Download file from storage
    await updateProgress("downloading", 10);
    console.log(`[PIPELINE] ${itemId}: downloading file ${item.file_path}`);
    const { data: fileData, error: downloadError } = await admin.storage
      .from("documents")
      .download(item.file_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message || "No data"}`);
    }
    console.log(`[PIPELINE] ${itemId}: downloaded ${item.original_filename}`);
    await updateProgress("triage", 20);

    // 4. Build the agent's input. The agent fetches its own org context
    //    via tool calls — no need to dump the whole DB into a system
    //    prompt anymore. See document-agent.ts.
    const batchData = item.document_batches;
    const batchOrgId = batchData?.organization_id as string;
    const userContext = (batchData?.user_context as string) || undefined;

    // Split-child context — the splitter already verified the per-section
    // investor mapping and pre-filled entity_id on this queue item. Pass
    // those signals to the agent so it skips re-discovery and (critically)
    // doesn't call split_document on what is now a single-section leaf.
    const isSplitChild = !!item.parent_queue_id;
    const splitContext = item.split_context as {
      known_investment_id?: string | null;
      known_entity_ids?: string[];
      user_context?: string | null;
    } | null;
    const preIdentifiedEntityId =
      (item.staged_entity_id as string | null) ??
      (item.ai_entity_id as string | null) ??
      null;
    const knownInvestmentId = splitContext?.known_investment_id ?? null;

    await updateProgress("extracting", 40);
    const fileBuffer = Buffer.isBuffer(fileData)
      ? fileData
      : Buffer.from(await (fileData as Blob).arrayBuffer());

    console.log(
      `[PIPELINE] ${itemId}: invoking document agent ` +
        `(documentId=${item.document_id}, isSplitChild=${isSplitChild}, ` +
        `preEntity=${preIdentifiedEntityId ?? "none"}, ` +
        `knownInvestment=${knownInvestmentId ?? "none"}, ` +
        `userContext=${!!userContext})`,
    );
    const { runDocumentAgent } = await import("./document-agent");
    const agentResult = await runDocumentAgent({
      queueItemId: itemId,
      documentId: (item.document_id as string | null) ?? null,
      orgId: batchOrgId,
      fileBuffer,
      mimeType: item.mime_type as string | null,
      filename: item.original_filename as string,
      userContext: userContext ?? splitContext?.user_context ?? null,
      isSplitChild,
      preIdentifiedEntityId,
      knownInvestmentId,
      password: options?.password,
    });
    console.log(
      `[PIPELINE] ${itemId}: agent ${agentResult.status} — ` +
        `${agentResult.toolCalls.length} tool calls, ${agentResult.tokensUsed} tokens. ` +
        agentResult.summary.slice(0, 200),
    );
    await updateProgress("completing", 85);

    // 7. Translate the agent's outcome into queue state. The agent has
    //    already applied any write actions via tools (link_*, update_*,
    //    record_*, split_*) — the worker's job is to mirror the resulting
    //    document state onto the queue item and set the right status.
    //
    //    - applied   → auto_ingested. Doc is filed; no user action needed.
    //    - deferred  → review_ready with approval_reason. Surface for human
    //                  decision via /review.
    //    - failed    → error with the failure message.
    let finalStatus: "auto_ingested" | "review_ready" | "error";
    let approvalReason: string | null = null;
    let extractionError: string | null = null;
    if (agentResult.status === "applied") {
      finalStatus = "auto_ingested";
    } else if (agentResult.status === "deferred") {
      finalStatus = "review_ready";
      approvalReason = "agent_deferred";
    } else {
      finalStatus = "error";
      extractionError = agentResult.summary;
    }

    // Review/chat unification: when the agent defers, materialize a
    // chat_sessions row that captures the agent's reasoning. /review reads
    // from this session for the card's defer reason / context, and "Open
    // in chat" reuses the same session — no duplicate state, no parallel
    // surfaces. The first assistant message carries the defer reason so
    // both the review card and a full chat view start from the same line.
    let chatSessionId: string | null = null;
    if (agentResult.status === "deferred") {
      const createdBy = batchData?.created_by as string | null;
      if (createdBy) {
        const sessionTitle = `Review: ${item.original_filename as string}`;
        const { data: session, error: sessionErr } = await admin
          .from("chat_sessions")
          .insert({
            user_id: createdBy,
            organization_id: batchOrgId,
            title:
              sessionTitle.length > 80
                ? sessionTitle.slice(0, 80) + "…"
                : sessionTitle,
          })
          .select("id")
          .single();
        if (sessionErr || !session) {
          // Non-fatal: log and continue. The queue item still goes to
          // review_ready; the review card just won't have a session-driven
          // detail view (falls back to ai_summary on the queue row).
          console.error(
            `[PIPELINE] ${itemId}: failed to create review chat session:`,
            sessionErr?.message,
          );
        } else {
          chatSessionId = session.id as string;
          // First assistant message: the agent's defer reason. Marked
          // mcp_chat:true so the message renderer treats it as a regular
          // orchestrator message. staged_actions starts empty — the
          // ReviewCard's pickers populate it on submit.
          const { error: msgErr } = await admin.from("chat_messages").insert({
            session_id: chatSessionId,
            role: "assistant",
            content: agentResult.summary,
            metadata: {
              mcp_chat: true,
              from_review: true,
              queue_item_id: itemId,
              document_id: (item.document_id as string | null) ?? null,
              defer_reason: agentResult.deferReason ?? null,
              tool_calls: agentResult.toolCalls.map((c) => ({
                name: c.name,
                ok: c.ok,
              })),
              staged_actions: [],
            },
          });
          if (msgErr) {
            console.error(
              `[PIPELINE] ${itemId}: failed to seed review chat message:`,
              msgErr.message,
            );
          }
        }
      } else {
        console.warn(
          `[PIPELINE] ${itemId}: deferred but batch has no created_by — skipping review session creation.`,
        );
      }
    }

    // Re-fetch the document row so we mirror its current state onto the
    // queue item. The agent set entity_id / investment_id / document_type
    // via update_document and link_document_to_* tools — those fields are
    // the source of truth, the queue's ai_* mirrors are for /review display.
    type DocFields = {
      entity_id: string | null;
      document_type: string | null;
      document_category: string | null;
      year: number | null;
    };
    let docRow: DocFields | null = null;
    if (item.document_id) {
      const { data: doc } = await admin
        .from("documents")
        .select("entity_id, document_type, document_category, year")
        .eq("id", item.document_id as string)
        .maybeSingle();
      if (doc) docRow = doc as unknown as DocFields;
    }

    {
      const { error } = await admin
        .from("document_queue")
        .update({
          status: finalStatus,
          ai_summary: agentResult.summary,
          ai_entity_id: docRow?.entity_id ?? null,
          ai_document_type: docRow?.document_type ?? null,
          ai_document_category: docRow?.document_category ?? null,
          ai_year: docRow?.year ?? null,
          // Agent applies actions via tools as it goes — there's nothing
          // left to "propose" on /review. Defer reasons are surfaced via
          // approval_reason + ai_summary instead, and (when present) the
          // chat_session_id linkage to the agent's seeded conversation.
          ai_proposed_actions: [],
          approval_reason: approvalReason,
          extraction_error: extractionError,
          chat_session_id: chatSessionId,
          extraction_completed_at: new Date().toISOString(),
          extraction_tokens: agentResult.tokensUsed,
          // Cost telemetry (broken out so cache reads/writes are priced
          // correctly) — feeds the cost-per-document model.
          extraction_input_tokens: agentResult.usage.input,
          extraction_output_tokens: agentResult.usage.output,
          extraction_cache_read_tokens: agentResult.usage.cacheRead,
          extraction_cache_creation_tokens: agentResult.usage.cacheCreation,
          extraction_turns: agentResult.turns,
          extraction_model: agentResult.model,
          extraction_cost_usd: agentResult.costUsd,
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      assertNoDbError(error, `${itemId}: persist agent result`);
    }

    // Post a structured pipeline event into the chat session so the
    // orchestrator has authoritative context for follow-up turns and the
    // user sees live progress via Realtime. password_required and the
    // already-existing "first assistant message" for deferred items have
    // their own posters elsewhere; this handler covers the auto_ingested
    // and error paths (terminal states reached by the happy/sad agent
    // results — not the catch-block-level extraction errors).
    if (finalStatus === "auto_ingested") {
      // Look up the investment that the agent linked to, if any. The
      // document agent persists this via update_document/link_document_to_*,
      // so we mirror it from the refreshed docRow lookups + a follow-up
      // investment_id read.
      let investmentId: string | null = null;
      if (item.document_id) {
        const { data: docInv } = await admin
          .from("documents")
          .select("investment_id")
          .eq("id", item.document_id as string)
          .maybeSingle();
        investmentId = (docInv?.investment_id as string | null) ?? null;
      }
      await postPipelineEvent(admin, {
        batchId: item.batch_id as string,
        queueItemId: itemId,
        event: "auto_ingested",
        filename: item.original_filename as string,
        documentId: (item.document_id as string | null) ?? null,
        entityId: docRow?.entity_id ?? null,
        investmentId,
        summary: agentResult.summary,
      });
    } else if (finalStatus === "review_ready") {
      await postPipelineEvent(admin, {
        batchId: item.batch_id as string,
        queueItemId: itemId,
        event: "deferred",
        filename: item.original_filename as string,
        documentId: (item.document_id as string | null) ?? null,
        entityId: docRow?.entity_id ?? null,
        summary: agentResult.summary,
        reviewSessionId: chatSessionId,
      });
    } else if (finalStatus === "error") {
      await postPipelineEvent(admin, {
        batchId: item.batch_id as string,
        queueItemId: itemId,
        event: "error",
        filename: item.original_filename as string,
        documentId: (item.document_id as string | null) ?? null,
        errorMessage: extractionError,
      });
    }

    // 12. If this item is a split child, run sibling dedup. The pass is
    //     idempotent — every child triggers it as it finishes, and the last
    //     one to land has the most complete picture. Without this, two
    //     siblings can each propose `record_investment_transaction` for the
    //     same (investment, investor, date, amount) and the user gets
    //     duplicate cards in /review (Distribution #3 had this with two
    //     Emma cards for $96,086.69 / 2022-08-19). See sibling-dedup.ts.
    const parentQueueId = (item.parent_queue_id as string | null) ?? null;
    if (parentQueueId) {
      const { dedupSiblingProposals } = await import("./sibling-dedup");
      try {
        await dedupSiblingProposals(admin, parentQueueId);
      } catch (err) {
        // Dedup is best-effort — a failure here shouldn't kill the child's
        // own extraction. The user will see the un-deduped cards and can
        // reject duplicates manually. Log loudly so we notice in dev.
        console.error(
          `[PIPELINE] ${itemId}: sibling-dedup failed for parent ${parentQueueId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // 13. Update batch stats
    await updateBatchStats(admin, item.batch_id);
  } catch (err) {
    // Password-protected PDFs: park the item as password_required. Don't
    // log to Sentry — it's a normal user-action-required state, not a bug.
    // The rest of the batch keeps processing; the user supplies the
    // password later via chat (unlock_document) or the inline UI.
    if (err instanceof PdfPasswordRequiredError) {
      console.log(`[PIPELINE] ${itemId}: password required for ${item.original_filename}`);
      const { error: markErr } = await admin
        .from("document_queue")
        .update({
          status: "password_required",
          extraction_error: null,
          extraction_completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", itemId);
      // The bug we caught with migration 054 hit exactly here — this UPDATE
      // would silently fail if the enum was missing the value. Throw loudly
      // now so future schema drift is impossible to miss.
      assertNoDbError(markErr, `${itemId}: mark password_required`);
      await updateBatchStats(admin, item.batch_id);
      return;
    }

    Sentry.withScope((scope) => {
      scope.setTag("feature", "extraction");
      scope.setExtra("queueItemId", itemId);
      scope.setExtra("batchId", item.batch_id);
      scope.setExtra("filename", item.original_filename);
      scope.setExtra("docType", item.staged_doc_type);
      Sentry.captureException(err);
    });
    const rawMessage = err instanceof Error ? err.message : String(err);
    console.error(`Extraction failed for queue item ${itemId}:`, rawMessage);

    // Translate raw API errors into user-friendly messages. The large-document
    // case gets a richer page-count message; everything else runs through the
    // shared sanitizer so no signed URL / UUID / request id is ever persisted
    // to a user-facing field. (Raw detail still goes to Sentry + console above.)
    let friendlyMessage: string;
    if (rawMessage.includes("prompt is too long") || rawMessage.includes("too many tokens")) {
      const pages = item.pdf_page_count;
      friendlyMessage = pages
        ? `This document is too large to process (${pages} pages). Try uploading individual sections instead.`
        : "This document is too large to process. Try uploading individual sections instead.";
    } else {
      friendlyMessage = friendlyProcessingError(rawMessage);
    }

    const { error: markErrorErr } = await admin
      .from("document_queue")
      .update({
        status: "error",
        extraction_error: friendlyMessage,
        extraction_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
    // We're already in the failure path — log loudly but don't throw, so
    // updateBatchStats still runs and the batch isn't left half-counted.
    logDbError(markErrorErr, `${itemId}: mark status=error`);

    // Soft-delete the linked document so it doesn't sit forever as an
    // orphan with status='processing' and deleted_at=null. Without this,
    // a failed extraction leaves a documents row that silently blocks all
    // future hash-based dedupe — exactly the case where the user uploads
    // 6 files, processing fails on every one, and the next upload of the
    // same files dedupe's to zero queue rows with no UI signal.
    if (item.document_id) {
      const { error: docDelErr } = await admin
        .from("documents")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", item.document_id as string)
        .is("deleted_at", null);
      logDbError(docDelErr, `${itemId}: soft-delete linked document on error`);
    }

    // Surface the failure in the originating chat session so the user
    // (and the orchestrator on its next turn) sees what happened, not
    // just silent absence.
    await postPipelineEvent(admin, {
      batchId: item.batch_id as string,
      queueItemId: itemId,
      event: "error",
      filename: item.original_filename as string,
      documentId: (item.document_id as string | null) ?? null,
      errorMessage: friendlyMessage,
    });

    await updateBatchStats(admin, item.batch_id);
  }
}

/**
 * Resolve the chat session a pipeline-driven event should post into.
 * Priority:
 *   1. batch.metadata.session_id IF the session belongs to this org.
 *      Metadata is user-supplied at batch creation, so we re-verify org
 *      ownership — otherwise a tampered session_id could leak a system
 *      message into a different tenant.
 *   2. The user's most recent chat_session in this org.
 *   3. Create a new "Document uploads" session.
 *
 * Returns null if even fallback creation fails (no created_by, etc.).
 */
async function resolveBatchSession(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
): Promise<{ sessionId: string; orgId: string } | null> {
  const { data: batch } = await admin
    .from("document_batches")
    .select("created_by, organization_id, metadata")
    .eq("id", batchId)
    .single();
  if (!batch?.created_by || !batch.organization_id) {
    return null;
  }

  const claimedSessionId = (batch.metadata as { session_id?: string } | null)?.session_id;
  if (claimedSessionId) {
    const { data: claimed } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("id", claimedSessionId)
      .eq("organization_id", batch.organization_id)
      .maybeSingle();
    if (claimed) return { sessionId: claimed.id as string, orgId: batch.organization_id as string };
    console.warn(
      `[PIPELINE] Batch ${batchId}: session_id ${claimedSessionId} from metadata does not belong to org ${batch.organization_id}; falling back to recent/new session`,
    );
  }

  const { data: recent } = await admin
    .from("chat_sessions")
    .select("id")
    .eq("user_id", batch.created_by)
    .eq("organization_id", batch.organization_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) return { sessionId: recent.id as string, orgId: batch.organization_id as string };

  const { data: created, error: sessionErr } = await admin
    .from("chat_sessions")
    .insert({
      user_id: batch.created_by,
      organization_id: batch.organization_id,
      title: "Document uploads",
    })
    .select("id")
    .single();
  logDbError(sessionErr, `Batch ${batchId}: create fallback chat session`);
  if (!created) return null;
  return { sessionId: created.id as string, orgId: batch.organization_id as string };
}

/**
 * Post a structured pipeline event into the chat session associated with a
 * batch. These messages give the chat orchestrator both real-time narration
 * material AND authoritative document_id / entity_id / investment_id
 * references in metadata, so it can react to completions on the user's
 * next turn without polling via tools.
 *
 * The chat-drawer's Realtime subscription delivers these messages live —
 * the user sees pipeline progress in the chat panel without needing to
 * send anything.
 *
 * Best-effort — failures are logged, not surfaced. The pipeline keeps
 * processing regardless.
 */
async function postPipelineEvent(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    batchId: string;
    queueItemId: string;
    event: "auto_ingested" | "deferred" | "error";
    filename: string;
    documentId?: string | null;
    entityId?: string | null;
    investmentId?: string | null;
    summary?: string | null;
    errorMessage?: string | null;
    reviewSessionId?: string | null;
  },
): Promise<void> {
  try {
    const session = await resolveBatchSession(admin, params.batchId);
    if (!session) return;

    let content: string;
    switch (params.event) {
      case "auto_ingested":
        content = `Filed: ${params.filename}.${params.summary ? "\n\n" + params.summary : ""}`;
        break;
      case "deferred":
        content = `Needs review: ${params.filename}.${params.summary ? "\n\n" + params.summary : ""}`;
        break;
      case "error":
        content = `Failed to extract ${params.filename}.${params.errorMessage ? "\n\n" + params.errorMessage : ""}`;
        break;
    }

    const { error: msgErr } = await admin.from("chat_messages").insert({
      session_id: session.sessionId,
      role: "assistant",
      content,
      metadata: {
        type: "pipeline_event",
        event: params.event,
        batch_id: params.batchId,
        queue_item_id: params.queueItemId,
        document_id: params.documentId ?? null,
        entity_id: params.entityId ?? null,
        investment_id: params.investmentId ?? null,
        filename: params.filename,
        review_session_id: params.reviewSessionId ?? null,
      },
    });
    logDbError(msgErr, `Batch ${params.batchId}: insert pipeline_event (${params.event})`);
  } catch (err) {
    console.error(`[PIPELINE] Batch ${params.batchId}: pipeline_event post failed:`, err);
  }
}

/**
 * Post a system-style chat message listing any password-protected files in
 * the batch so the user can supply passwords without leaving chat. Re-uses
 * the existing chat_messages insert path; Realtime delivers the message to
 * any open drawer instances. No-op when no items are password_required.
 *
 * Best-effort — failures are logged, not surfaced. The user can still
 * unlock via the inline UI on /review or /batches/[id] as a fallback.
 */
async function notifyPasswordRequiredItems(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
): Promise<void> {
  try {
    const { data: lockedItems } = await admin
      .from("document_queue")
      .select("id, original_filename")
      .eq("batch_id", batchId)
      .eq("status", "password_required");
    if (!lockedItems || lockedItems.length === 0) return;

    const session = await resolveBatchSession(admin, batchId);
    if (!session) {
      console.warn(`[PIPELINE] Batch ${batchId}: could not resolve a session for password notification`);
      return;
    }
    const sessionId = session.sessionId;

    const n = lockedItems.length;
    const fileLines = lockedItems
      .map((i) => `  - ${i.original_filename}`)
      .join("\n");
    const content =
      `${n} document${n === 1 ? "" : "s"} from your upload need${n === 1 ? "s" : ""} a password to process:\n` +
      `${fileLines}\n\n` +
      `Share the password${n === 1 ? "" : "s"} here and I'll unlock ${n === 1 ? "it" : "them"}.`;

    const { error: msgErr } = await admin.from("chat_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content,
      metadata: {
        type: "password_request",
        batch_id: batchId,
        locked_items: lockedItems.map((i) => ({
          id: i.id,
          filename: i.original_filename,
        })),
      },
    });
    logDbError(msgErr, `Batch ${batchId}: insert password_request chat message`);
  } catch (err) {
    console.error(`[PIPELINE] Batch ${batchId}: password-request notification failed:`, err);
  }
}

/**
 * Auto-summary: trigger the chat orchestrator to write a synthesized
 * "here's what just happened" message after a batch reaches end-of-phase.
 *
 * Two phase triggers:
 *   - "initial":    fires from processBatch after the worker is done with
 *                   the initial pass. Mentions password_required items but
 *                   doesn't wait for them — phase B per the user spec.
 *   - "post-unlock": fires from the unlock route after the unlocked item
 *                   reaches a terminal state. Tells the user "now that's
 *                   handled too."
 *
 * The orchestrator gets a synthetic user message of the form
 * `[BATCH_SUMMARY:<batch_id>:<reason>]` — its system prompt knows to
 * interpret this as a system signal (not a real user request) and write
 * a concise narrative. The message is persisted as an assistant message
 * in the originating chat session so it lands wherever the upload came
 * from. Session.updated_at gets bumped so the chat-drawer's session list
 * floats the originating session to the top.
 *
 * Best-effort — failures are logged, not surfaced. The pipeline keeps
 * working regardless. If the batch wasn't chat-originated (no session
 * resolvable), we skip cleanly.
 */
export async function generateBatchSummary(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
  reason: "initial" | "post-unlock" = "initial",
): Promise<void> {
  try {
    const session = await resolveBatchSession(admin, batchId);
    if (!session) {
      // No chat session for this batch (e.g., a non-chat /review drop) —
      // nothing to summarize into. Skip silently.
      return;
    }

    // Need at least one queue item to summarize. Filter out null
    // document_id rows that can show up if a register insert partially
    // succeeded before the documents row was created.
    const { data: items } = await admin
      .from("document_queue")
      .select("status")
      .eq("batch_id", batchId);
    if (!items || items.length === 0) return;

    // Fetch the batch creator's user identity so the orchestrator can
    // personalize the summary ("I filed X for Sean…"). Falls through
    // gracefully when created_by is null.
    const { data: batchMeta } = await admin
      .from("document_batches")
      .select("created_by, organization_id")
      .eq("id", batchId)
      .single();
    if (!batchMeta?.organization_id) return;
    const orgId = batchMeta.organization_id as string;

    type UserIdentity = {
      name: string;
      email: string;
      orgName: string;
    };
    let userIdentity: UserIdentity | undefined;
    if (batchMeta.created_by) {
      const [userRes, orgRes] = await Promise.all([
        admin
          .from("users")
          .select("name, email")
          .eq("id", batchMeta.created_by as string)
          .maybeSingle(),
        admin
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .maybeSingle(),
      ]);
      if (userRes.data && orgRes.data) {
        userIdentity = {
          name: (userRes.data.name as string | null) ?? (userRes.data.email as string),
          email: userRes.data.email as string,
          orgName: orgRes.data.name as string,
        };
      }
    }

    // Recent session history feeds the orchestrator so it can read the
    // pipeline_event messages and respond cohesively. Cap at 100 to
    // bound token use; the orchestrator already truncates internally too.
    const { data: history } = await admin
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", session.sessionId)
      .order("created_at", { ascending: true })
      .limit(100);

    const orchestratorHistory: OrchestratorMessage[] = (history ?? []).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content as string,
    }));

    // The system prompt's "Auto-summary mode" section keys on this exact
    // bracketed pattern. Don't alter it without updating system-prompt.ts.
    const triggerMessage = `[BATCH_SUMMARY:${batchId}:${reason}]`;

    const anthropic = new Anthropic() as unknown as AnthropicClientLike;

    let finalText = "";
    for await (const event of runOrchestratorStreaming({
      ctx: {
        userId: (batchMeta.created_by as string | null) ?? "",
        orgId,
        sessionId: session.sessionId,
        supabase: admin,
        redact,
      },
      userMessage: triggerMessage,
      history: orchestratorHistory,
      pageContext: null,
      userIdentity,
      anthropic,
    })) {
      if (event.type === "done") {
        finalText = event.text;
      }
    }

    if (!finalText) {
      console.warn(`[PIPELINE] Batch ${batchId}: orchestrator produced no summary text`);
      return;
    }

    const { error: insertErr } = await admin.from("chat_messages").insert({
      session_id: session.sessionId,
      role: "assistant",
      content: finalText,
      metadata: {
        type: "batch_summary",
        batch_id: batchId,
        reason,
        mcp_chat: true,
      },
    });
    logDbError(insertErr, `Batch ${batchId}: insert batch_summary message`);

    // Bump session.updated_at so the originating session floats to the
    // top of any session list sorted by recency. Combined with a
    // client-side unread badge (separate change), users in a different
    // session can see "your upload finished — check session X".
    await admin
      .from("chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", session.sessionId);
  } catch (err) {
    console.error(`[PIPELINE] Batch ${batchId}: generateBatchSummary failed:`, err);
  }
}

/**
 * Recalculate and update batch statistics.
 *
 * Called after the worker finishes processing a batch AND after individual
 * queue items reach a terminal status via the approve/reject/ingest-only
 * routes. The latter is what flips the batch from 'review' to 'completed'
 * once the user has worked through every review_ready item — without this,
 * the NotificationBell badge would stick on 'review' indefinitely.
 */
export async function updateBatchStats(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string
): Promise<void> {
  const { data: items } = await admin
    .from("document_queue")
    .select("status, ai_proposed_entity")
    .eq("batch_id", batchId);

  if (!items) return;

  const stats = {
    total_documents: items.length,
    staged_count: items.filter((i) => i.status === "staged").length,
    queued_count: items.filter((i) => i.status === "queued").length,
    extracted_count: items.filter(
      (i) => ["review_ready", "approved", "auto_ingested"].includes(i.status)
    ).length,
    approved_count: items.filter((i) => i.status === "approved" || i.status === "auto_ingested").length,
    rejected_count: items.filter((i) => i.status === "rejected").length,
    error_count: items.filter((i) => i.status === "error").length,
    new_entities_proposed: items.filter((i) => i.ai_proposed_entity != null)
      .length,
    updated_at: new Date().toISOString(),
  };

  // Determine batch status
  const TERMINAL = ["approved", "auto_ingested", "rejected", "error"];
  const allDone = items.every((i) => TERMINAL.includes(i.status));
  const anyExtracting = items.some(
    (i) => i.status === "queued" || i.status === "extracting"
  );
  // password_required items are "waiting for the user", same UX bucket as
  // review_ready — they keep the batch in 'review' so the user knows
  // there's something to act on.
  const anyNeedsAttention = items.some(
    (i) => i.status === "review_ready" || i.status === "password_required"
  );

  let batchStatus: string;
  if (allDone) batchStatus = "completed";
  else if (anyExtracting) batchStatus = "processing";
  else if (anyNeedsAttention) batchStatus = "review";
  else batchStatus = "staging";

  // Final batch row write — drives the bell, the /review sections, and the
  // batch handoff card. If this silently no-ops, the entire UX downstream
  // ends up with stale state, so check the error explicitly.
  const { error: statsErr } = await admin
    .from("document_batches")
    .update({ ...stats, status: batchStatus })
    .eq("id", batchId);
  logDbError(statsErr, `Batch ${batchId}: write stats + status=${batchStatus}`);
}

/**
 * Process all queued items in a batch with concurrency control. Each
 * item runs through the document agent independently — no shared state
 * is preloaded at the batch level since the agent fetches what it needs
 * via tool calls.
 */
export async function processBatch(
  batchId: string,
  concurrency: number = 3
): Promise<void> {
  const admin = createAdminClient();

  const { data: items, error } = await admin
    .from("document_queue")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "queued")
    .order("created_at");

  if (error || !items || items.length === 0) {
    console.log(`[PIPELINE] Batch ${batchId}: no queued items found (error=${!!error})`);
    return;
  }

  console.log(`[PIPELINE] Batch ${batchId}: processing ${items.length} items`);

  const { data: batch } = await admin
    .from("document_batches")
    .select("organization_id")
    .eq("id", batchId)
    .single();

  const itemIds = items.map((i) => i.id);
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < itemIds.length) {
      const currentIndex = index++;
      const itemId = itemIds[currentIndex];
      try {
        await processQueueItem(itemId);
      } catch (err) {
        Sentry.captureException(err);
        console.error(`Worker error for item ${itemId}:`, err);
      }
    }
  }

  // Start 'concurrency' number of workers
  const workers = Array.from({ length: Math.min(concurrency, itemIds.length) }, () =>
    runNext()
  );

  await Promise.all(workers);

  // Final batch status update
  await updateBatchStats(admin, batchId);

  // Notify the user via chat about any password-protected files. This must
  // happen after updateBatchStats so the batch's status is settled when the
  // notification fires.
  await notifyPasswordRequiredItems(admin, batchId);

  // Auto-summary (phase 1, "initial"): synthesize a narrative summary of
  // what just happened and post it back into the originating chat session.
  // Doesn't wait for password_required items to be unlocked — those get
  // mentioned in this summary and resolved in the phase-2 summary later.
  // Best-effort; failures don't block batch completion.
  await generateBatchSummary(admin, batchId, "initial");

  // Fire-and-forget: refresh inferred document patterns across the org.
  // Newly ingested documents may have changed cross-entity patterns
  // (e.g. "most LLCs now have 2025 K-1s"), so rerun the inference engine.
  if (batch?.organization_id) {
    import("@/lib/utils/inference-engine")
      .then(({ runInferenceEngine }) =>
        runInferenceEngine(batch.organization_id as string).catch((err) =>
          console.error(`[PIPELINE] Batch ${batchId}: post-batch inference failed:`, err),
        ),
      )
      .catch(() => {});
  }
}
