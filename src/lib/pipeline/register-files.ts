import { createOrgClient } from "@/lib/supabase/org-client";
import { classifyByFilename, matchEntityByHint, guessDirection } from "@/lib/pipeline/classify";

/**
 * Register already-in-storage files onto a batch: dedup by content hash,
 * classify by filename, create document_queue rows (status='staged') + early
 * documents rows (status='processing'), and update batch stats.
 *
 * Extracted from POST /api/pipeline/batches/[batchId]/upload so the email
 * inbound worker can inject files through the SAME pipeline (CLAUDE.md §3:
 * one ingestion pipeline, no forks). The route keeps HTTP concerns (auth,
 * abuse alarm, storage-path validation, audit); this owns the registration
 * semantics for both callers.
 */

export type RegisterFile = {
  originalName: string;
  storagePath: string;
  size: number;
  type?: string | null;
  contentHash: string;
};

export type RegisterResult = {
  uploaded: Array<Record<string, unknown>>;
  duplicates: Array<{ filename: string; reason: string; existing_document_id?: string | null }>;
  allDeduped: boolean;
};

export async function registerBatchFiles(opts: {
  orgId: string;
  /** Uploader for documents.uploaded_by; null for system paths (email inbound). */
  userId: string | null;
  batchId: string;
  files: RegisterFile[];
  /** document_queue.source_type — 'upload' (default) or 'email_inbound'. */
  sourceType?: string;
}): Promise<RegisterResult> {
  const { orgId, userId, batchId, files, sourceType = "upload" } = opts;
  const db = createOrgClient(orgId);

  const { data: batch, error: batchError } = await db
    .from("document_batches")
    .select("id, entity_id, entity_discovery")
    .eq("id", batchId)
    .single();
  if (batchError || !batch) throw new Error("Batch not found");

  // Get entities for matching (only if no entity_id on batch)
  let entities: Array<{ id: string; name: string; short_name: string | null }> = [];
  let batchEntityName: string | null = null;
  if (batch.entity_id) {
    const { data } = await db.from("entities").select("name").eq("id", batch.entity_id).single();
    batchEntityName = data?.name || null;
  } else {
    const { data } = await db.from("entities").select("id, name, short_name").order("name");
    entities = data || [];
  }

  const uploaded: Array<Record<string, unknown>> = [];
  const duplicates: RegisterResult["duplicates"] = [];

  // Batch duplicate checks
  const allHashes = files.map((f) => f.contentHash);
  const duplicateDocHashes = new Map<string, string>();
  const duplicateDocIds = new Map<string, string>();
  const duplicateQueueHashes = new Map<string, string>();

  if (allHashes.length > 0) {
    const [docDupes, queueDupes] = await Promise.all([
      db
        .from("documents")
        .select("id, content_hash, name")
        .in("content_hash", allHashes)
        .is("deleted_at", null),
      db
        .from("document_queue")
        .select("content_hash, original_filename")
        .in("content_hash", allHashes)
        .in("status", ["staged", "queued", "extracting", "extracted", "review_ready"]),
    ]);
    for (const doc of docDupes.data || []) {
      duplicateDocHashes.set(doc.content_hash, doc.name);
      duplicateDocIds.set(doc.content_hash, doc.id);
    }
    for (const q of queueDupes.data || []) {
      duplicateQueueHashes.set(q.content_hash, q.original_filename);
    }
  }

  for (const file of files) {
    const contentHash = file.contentHash;

    // Duplicates — include the existing document_id so Claude can reference
    // it for linking without searching.
    const existingDocName = duplicateDocHashes.get(contentHash);
    if (existingDocName) {
      duplicates.push({
        filename: file.originalName,
        reason: `Duplicate of existing document "${existingDocName}"`,
        existing_document_id: duplicateDocIds.get(contentHash) || null,
      });
      continue;
    }
    const existingQueueName = duplicateQueueHashes.get(contentHash);
    if (existingQueueName) {
      duplicates.push({
        filename: file.originalName,
        reason: `Duplicate of queued file "${existingQueueName}"`,
      });
      continue;
    }

    const classification = classifyByFilename(file.originalName);

    let entityId = batch.entity_id || null;
    let entityName: string | null = null;
    if (entityId) entityName = batchEntityName;
    if (!entityId && classification.entity_hint) {
      const match = matchEntityByHint(classification.entity_hint, entities);
      if (match) {
        entityId = match.id;
        entityName = match.name;
      }
    }

    const direction = classification.direction || guessDirection(file.originalName, classification.document_type);

    const { data: queueItem, error: queueError } = await db
      .from("document_queue")
      .insert({
        batch_id: batchId,
        status: "staged",
        original_filename: file.originalName,
        file_path: file.storagePath,
        file_size: file.size,
        mime_type: file.type || null,
        content_hash: contentHash,
        staged_doc_type: classification.document_type,
        staged_entity_id: entityId,
        staged_entity_name: entityName,
        staged_year: classification.year,
        staged_category: classification.category,
        staging_confidence: classification.confidence,
        is_composite: classification.is_composite,
        ai_direction: direction,
        source_type: sourceType,
      })
      .select()
      .single();

    if (queueError) {
      console.error(`Queue insert error for ${file.originalName}:`, queueError);
      continue;
    }

    // Early documents row so the ID is linkable in the same turn; the worker
    // updates it with extraction results + status='ready'.
    let documentId: string | null = null;
    try {
      const { data: docRow } = await db
        .from("documents")
        .insert({
          entity_id: entityId,
          name: file.originalName,
          document_type: classification.document_type || "other",
          document_category: classification.category || null,
          year: classification.year || null,
          file_path: file.storagePath,
          file_size: file.size,
          mime_type: file.type || null,
          uploaded_by: userId,
          content_hash: contentHash,
          direction: direction || null,
          ai_extracted: false,
          status: "processing",
        })
        .select("id")
        .single();
      if (docRow) {
        documentId = docRow.id;
        await db.from("document_queue").update({ document_id: docRow.id }).eq("id", queueItem.id);
      }
    } catch (docErr) {
      console.error(`Early doc creation failed for ${file.originalName}:`, docErr);
    }

    uploaded.push({ ...queueItem, document_id: documentId });
  }

  // Batch stats
  const { count: totalCount } = await db
    .from("document_queue")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .not("status", "in", '("rejected","error")');
  const { count: stagedCount } = await db
    .from("document_queue")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("status", "staged");

  // Persist duplicate detections so batch surfaces can show "X already filed"
  // after a reload (silent dedupe once masked a 5-of-6 no-op as success).
  const { data: existingBatch } = await db
    .from("document_batches")
    .select("metadata")
    .eq("id", batchId)
    .single();
  const mergedMetadata = {
    ...((existingBatch?.metadata as Record<string, unknown> | null) ?? {}),
    duplicates: duplicates.map((d) => ({
      filename: d.filename,
      reason: d.reason,
      existing_document_id: d.existing_document_id ?? null,
    })),
  };

  // Fully-deduped batches are done before they start — complete them so they
  // never sit in PROCESSING NOW with no queue rows to terminate them.
  const allDeduped = uploaded.length === 0 && duplicates.length > 0;

  await db
    .from("document_batches")
    .update({
      total_documents: totalCount || 0,
      staged_count: stagedCount || 0,
      metadata: mergedMetadata,
      ...(allDeduped ? { status: "completed" as const } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);

  return { uploaded, duplicates, allDeduped };
}
