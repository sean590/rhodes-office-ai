/**
 * Queue-item lifecycle primitives — file (approve) or reject. Shared by the
 * pipeline API routes AND the MCP tools so chat can do the same thing the
 * /review page does. Agent-era contract: when these are called, the document
 * agent has already applied the actual mutations (link_document_to_*,
 * update_investment_transaction, etc.) via tool calls. The queue item just
 * needs its status flipped + an audit log entry.
 *
 * Legacy `ai_proposed_actions` handling lives in the existing approve/ingest-only
 * routes (to be deleted with the rest of the proposal-model machinery). New
 * callers should use these primitives.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/utils/audit";
import { updateBatchStats } from "./worker";

interface QueueItemRow {
  id: string;
  batch_id: string;
  status: string;
  document_id: string | null;
  original_filename: string;
  ai_suggested_name: string | null;
  ai_entity_id: string | null;
  staged_entity_id: string | null;
  ai_document_type: string | null;
  staged_doc_type: string | null;
}

export interface QueueActionContext {
  orgId: string;
  /** May be null if the auth user has no public.users row yet — callers
   *  should fall back rather than 500. Audit log records null in that case. */
  userId: string | null;
  /** Optional: when the call comes from a UI request, request headers for
   *  the audit trail (IP, user-agent). Pure-server callers can omit. */
  requestContext?: Record<string, unknown>;
}

interface VerifyResult {
  ok: true;
  item: QueueItemRow;
}

interface VerifyFail {
  ok: false;
  error: string;
  status: number;
}

/** Cross-tenant guard. Looks up the queue item, verifies its batch belongs
 *  to the caller's org. 404 (not 403) so we don't leak existence across
 *  tenants — same convention as the existing routes. */
async function verifyQueueItemAccess(
  admin: ReturnType<typeof createAdminClient>,
  queueItemId: string,
  orgId: string,
): Promise<VerifyResult | VerifyFail> {
  const { data: item } = await admin
    .from("document_queue")
    .select(
      "id, batch_id, status, document_id, original_filename, ai_suggested_name, ai_entity_id, staged_entity_id, ai_document_type, staged_doc_type",
    )
    .eq("id", queueItemId)
    .maybeSingle();
  if (!item) return { ok: false, error: "Queue item not found", status: 404 };
  const { data: batch } = await admin
    .from("document_batches")
    .select("id")
    .eq("id", item.batch_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!batch) return { ok: false, error: "Queue item not found", status: 404 };
  return { ok: true, item: item as QueueItemRow };
}

/** Resolve the entity name behind ai_entity_id / staged_entity_id for the
 *  audit feed so it reads "Filed: {Entity} — {Document}" instead of just
 *  the bare document name. Best-effort. */
async function resolveAuditEntityName(
  admin: ReturnType<typeof createAdminClient>,
  item: QueueItemRow,
): Promise<{ entityId: string | null; entityName: string | null }> {
  const entityId = item.ai_entity_id || item.staged_entity_id;
  if (!entityId) return { entityId: null, entityName: null };
  const { data: ent } = await admin
    .from("entities")
    .select("name")
    .eq("id", entityId)
    .maybeSingle();
  return { entityId, entityName: (ent as { name?: string } | null)?.name ?? null };
}

export interface FileQueueItemResult {
  ok: true;
  /** Null when the item was already gone (a stale file action). */
  item: QueueItemRow | null;
  documentId: string | null;
  /** True when there was nothing to do — the item was already filed or no
   *  longer in the queue. A benign no-op, reported as success (not a failure)
   *  so stale staged file-actions don't surface scary "not found" errors. */
  noop?: boolean;
}
export type FileQueueItemFailure = VerifyFail;

/**
 * File (approve) a queue item. Marks status=approved, mirrors the queue item
 * onto the documents row (sets documents.status='ready'), runs an audit log.
 * Idempotent against the agent-era contract — the document agent has already
 * filled in entity/investment/transaction links via its write tools, so this
 * function only needs to flip statuses and surface the doc to the user's
 * filing views.
 */
export async function fileQueueItem(
  queueItemId: string,
  ctx: QueueActionContext,
): Promise<FileQueueItemResult | FileQueueItemFailure> {
  const admin = createAdminClient();
  const verify = await verifyQueueItemAccess(admin, queueItemId, ctx.orgId);
  if (!verify.ok) {
    // Item is gone (404). Staged actions are async: between the agent staging
    // a file action and the user approving it, the item is often already filed
    // and cleaned up — or superseded by a re-split. That's a benign no-op, not
    // a failure; surfacing "Queue item not found" reads as a scary error for
    // something that's actually done.
    if (verify.status === 404) {
      return { ok: true, item: null, documentId: null, noop: true };
    }
    return verify;
  }
  const item = verify.item;

  // Already filed (approved or auto-ingested by the pipeline) → idempotent
  // no-op. Common when the pipeline auto-files between staging and approval,
  // or when the same file action is approved twice.
  if (item.status === "approved" || item.status === "auto_ingested") {
    return { ok: true, item, documentId: item.document_id, noop: true };
  }

  // Genuinely not fileable (still queued/extracting/errored, or rejected) —
  // these are real failures, not "already done": the document isn't filed.
  if (item.status !== "review_ready" && item.status !== "extracted") {
    return {
      ok: false,
      error: `Cannot file item in status: ${item.status}`,
      status: 400,
    };
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("document_queue")
    .update({
      status: "approved",
      reviewed_by: ctx.userId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("id", queueItemId);
  if (updateErr) {
    return { ok: false, error: updateErr.message, status: 500 };
  }

  // The documents row was created in 'processing' state at upload-time
  // (or by the splitter for split children). Flip to 'ready' so it shows
  // up in the user's entity / investment views. The agent's tool calls
  // populated all the foreign keys already.
  if (item.document_id) {
    await admin
      .from("documents")
      .update({ status: "ready", updated_at: now })
      .eq("id", item.document_id);
  }

  const { entityId, entityName } = await resolveAuditEntityName(admin, item);
  await logAuditEvent({
    userId: ctx.userId,
    action: "approve",
    resourceType: "pipeline_item",
    resourceId: queueItemId,
    entityId,
    metadata: {
      batch_id: item.batch_id,
      document_name: item.ai_suggested_name || item.original_filename,
      document_type: item.ai_document_type || item.staged_doc_type,
      entity_name: entityName,
    },
    ...(ctx.requestContext ?? {}),
  });

  await updateBatchStats(admin, item.batch_id);

  return { ok: true, item, documentId: item.document_id };
}

export interface RejectQueueItemResult {
  ok: true;
  item: QueueItemRow;
}
export type RejectQueueItemFailure = VerifyFail;

/**
 * Reject a queue item. Marks status=rejected with an optional reason. Does
 * NOT undo any agent-applied mutations — those are the user's call to revert
 * via chat. Reject means "this doc shouldn't be filed under the agent's
 * proposal," not "roll back everything the agent did."
 */
export async function rejectQueueItem(
  queueItemId: string,
  ctx: QueueActionContext,
  reason?: string | null,
): Promise<RejectQueueItemResult | RejectQueueItemFailure> {
  const admin = createAdminClient();
  const verify = await verifyQueueItemAccess(admin, queueItemId, ctx.orgId);
  if (!verify.ok) return verify;
  const item = verify.item;

  const now = new Date().toISOString();
  const { error: updateErr } = await admin
    .from("document_queue")
    .update({
      status: "rejected",
      extraction_error: reason ?? null,
      reviewed_by: ctx.userId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("id", queueItemId);
  if (updateErr) {
    return { ok: false, error: updateErr.message, status: 500 };
  }

  const { entityId, entityName } = await resolveAuditEntityName(admin, item);
  await logAuditEvent({
    userId: ctx.userId,
    action: "reject",
    resourceType: "pipeline_item",
    resourceId: queueItemId,
    entityId,
    metadata: {
      reason: reason ?? null,
      batch_id: item.batch_id,
      document_name: item.ai_suggested_name || item.original_filename,
      document_type: item.ai_document_type || item.staged_doc_type,
      entity_name: entityName,
    },
    ...(ctx.requestContext ?? {}),
  });

  await updateBatchStats(admin, item.batch_id);

  return { ok: true, item };
}
