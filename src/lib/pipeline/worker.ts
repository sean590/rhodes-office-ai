/**
 * Pipeline worker — processes document queue items with concurrency control.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateDocumentTypeCache } from "@/lib/document-types";
import { getDbContext, extractDocument } from "./extract";
import type { ExtractionResult, SubDocument } from "./extract";
import { ingestQueueItem } from "./ingest";
import * as Sentry from "@sentry/nextjs";

/**
 * Route a queue item after extraction: auto-ingest (no user action needed)
 * or send to review queue (user decision required).
 */
function routeAfterExtraction(
  item: Record<string, unknown>,
  result: ExtractionResult
): { route: "auto_ingest" | "review_ready"; reason?: string } {
  // Multiple entities proposed (umbrella document) — needs user confirmation
  if (result.proposed_entities && result.proposed_entities.length > 1) {
    return { route: "review_ready", reason: "multi_entity_creation" };
  }

  // Single new entity proposed — needs user confirmation
  if (result.proposed_entity) {
    return { route: "review_ready", reason: "new_entity" };
  }

  // AI wants to make database changes — needs user approval
  if (result.actions && result.actions.length > 0) {
    return { route: "review_ready", reason: "database_mutations" };
  }

  // Ambiguous entity match — user should pick
  if (result.entity_match_confidence === "low") {
    return { route: "review_ready", reason: "ambiguous_match" };
  }

  // No entity matched at all — user should assign
  if (result.entity_match_confidence === "none" || !result.entity_id) {
    return { route: "review_ready", reason: "no_match" };
  }

  // AI proposed a new document type — user should confirm
  if (result.is_new_document_type) {
    return { route: "review_ready", reason: "new_doc_type" };
  }

  // All clear — auto-ingest
  return { route: "auto_ingest" };
}

/**
 * Process a single queue item through AI extraction.
 * Accepts an optional pre-fetched dbContext to avoid redundant DB queries within a batch.
 */
export async function processQueueItem(
  itemId: string,
  cachedDbContext?: string
): Promise<void> {
  const admin = createAdminClient();

  // 1. Fetch queue item (include batch org ID)
  const { data: item, error: itemError } = await admin
    .from("document_queue")
    .select("*, document_batches!fk_queue_batch(entity_discovery, organization_id, entity_id, user_context)")
    .eq("id", itemId)
    .single();

  if (itemError || !item) {
    console.error(`Queue item ${itemId} not found:`, itemError);
    return;
  }

  // Helper to update processing progress
  const updateProgress = async (step: string, progress: number) => {
    await admin.from("document_queue").update({
      processing_step: step,
      processing_progress: progress,
      updated_at: new Date().toISOString(),
    }).eq("id", itemId);
  };

  // 2. Update status to extracting
  await admin
    .from("document_queue")
    .update({
      status: "extracting",
      extraction_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

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

    // 4. Get DB context (use cached if provided, otherwise fetch org-scoped)
    const batchData = item.document_batches;
    const batchOrgId = batchData?.organization_id as string;
    console.log(`[PIPELINE] ${itemId}: fetching DB context (cached=${!!cachedDbContext}, orgId=${batchOrgId})`);
    const dbContext = cachedDbContext ?? await getDbContext(admin, batchOrgId);
    console.log(`[PIPELINE] ${itemId}: DB context ready (${dbContext.length} chars)`);

    // 5. Determine options
    // Entity discovery is off for entity-scoped uploads (document already has an owner)
    const entityDiscovery = batchData?.entity_id
      ? false
      : (batchData?.entity_discovery ?? false);
    const isCompositeCandidate =
      item.is_composite ||
      item.staged_doc_type === "tax_package" ||
      (item.staged_category === "tax" && item.mime_type === "application/pdf");

    // 6. Call shared extraction
    await updateProgress("extracting", 40);
    const userContext = (batchData?.user_context as string) || undefined;
    console.log(`[PIPELINE] ${itemId}: calling Claude API (composite=${isCompositeCandidate}, userContext=${!!userContext})`);
    const result = await extractDocument(
      fileData,
      item.mime_type,
      item.original_filename,
      item.staged_doc_type || item.staged_category,
      item.staged_year,
      dbContext,
      {
        entityDiscovery,
        compositeDetection: isCompositeCandidate,
        userContext,
      }
    );
    console.log(`[PIPELINE] ${itemId}: extraction complete (tokens=${result.tokens_used}, entity=${result.entity_id})`);
    await updateProgress("applying", 70);

    // 7. Handle dynamic document type creation
    if (result.is_new_document_type && result.document_type && result.new_type_label) {
      const { error: typeError } = await admin.from("document_types").insert({
        slug: result.document_type,
        label: result.new_type_label,
        category: result.new_type_category || "other",
        is_seed: false,
      });
      if (!typeError) {
        invalidateDocumentTypeCache();
      }
    }

    // 8. Handle composite results — create child queue items
    if (result.is_composite && result.sub_documents.length > 0) {
      const { data: entityList } = await admin
        .from("entities")
        .select("id, name, short_name")
        .eq("organization_id", batchOrgId)
        .order("name");
      await handleCompositeResult(admin, item, result.sub_documents, batchOrgId, entityList || []);
    }

    // 9. Route: auto-ingest or review queue
    await updateProgress("completing", 85);
    const routing = routeAfterExtraction(item, result);

    // 10. Update queue item with AI results
    await admin
      .from("document_queue")
      .update({
        status: routing.route === "auto_ingest" ? "extracted" : "review_ready",
        ai_extraction: { actions: result.actions, summary: result.summary, termination_signals: result.termination_signals },
        ai_summary: result.summary,
        ai_document_type: result.document_type,
        ai_document_category: result.document_category,
        ai_entity_id: result.entity_id,
        ai_year: result.year,
        ai_confidence: result.confidence,
        ai_proposed_actions: result.actions,
        ai_direction: result.direction,
        ai_proposed_entity: result.proposed_entity,
        ai_proposed_entities: result.proposed_entities.length > 0 ? result.proposed_entities : null,
        ai_suggested_name: result.suggested_name,
        ai_related_entities: result.related_entities.length > 0 ? result.related_entities : null,
        is_composite: result.is_composite,
        entity_match_confidence: result.entity_match_confidence,
        approval_reason: routing.reason || null,
        extraction_completed_at: new Date().toISOString(),
        extraction_tokens: result.tokens_used,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    // 11. Auto-ingest if routing says so
    if (routing.route === "auto_ingest") {
      // Re-fetch item with AI fields populated
      const { data: updatedItem } = await admin
        .from("document_queue")
        .select("*")
        .eq("id", itemId)
        .single();

      if (updatedItem) {
        const ingestResult = await ingestQueueItem({
          item: updatedItem,
          orgId: batchOrgId,
          applyMutations: false, // auto-ingest items have no actions by definition
          finalStatus: "auto_ingested",
        });
        if (!ingestResult.success) {
          console.error(`Auto-ingest failed for ${itemId}:`, ingestResult.error);
          // Fall back to review_ready so user can approve manually
          await admin
            .from("document_queue")
            .update({ status: "review_ready", approval_reason: "auto_ingest_failed" })
            .eq("id", itemId);
        }
      }
    }

    // 12. Update batch stats
    await updateBatchStats(admin, item.batch_id);
  } catch (err) {
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

    // Translate raw API errors into user-friendly messages
    let friendlyMessage = rawMessage;
    if (rawMessage.includes("prompt is too long") || rawMessage.includes("too many tokens")) {
      const pages = item.pdf_page_count;
      friendlyMessage = pages
        ? `This document is too large to process (${pages} pages). Try uploading individual sections instead.`
        : "This document is too large to process. Try uploading individual sections instead.";
    }

    await admin
      .from("document_queue")
      .update({
        status: "error",
        extraction_error: friendlyMessage,
        extraction_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    await updateBatchStats(admin, item.batch_id);
  }
}

/**
 * Handle composite extraction results — create child queue items for sub-documents.
 */
async function handleCompositeResult(
  admin: ReturnType<typeof createAdminClient>,
  parentItem: Record<string, unknown>,
  subDocuments: SubDocument[],
  batchOrgId: string,
  entityList: Array<{ id: string; name: string; short_name: string | null }>
): Promise<void> {
  // Resolve the parent/filing entity for linking K-1s back to the issuer
  const parentEntityId = (parentItem.ai_entity_id || parentItem.staged_entity_id) as string | null;

  await Promise.all(subDocuments.map(async (sub) => {
    // If no entity_id but has k1_recipient, try to match recipient to an existing entity
    if (!sub.entity_id && sub.k1_recipient) {
      const recipientLower = sub.k1_recipient.toLowerCase().replace(/[.,]/g, "").trim();
      const match = entityList.find((e) => {
        const nameLower = e.name.toLowerCase().replace(/[.,]/g, "").trim();
        const shortLower = (e.short_name || "").toLowerCase().replace(/[.,]/g, "").trim();
        return nameLower === recipientLower || shortLower === recipientLower
          || nameLower.includes(recipientLower) || recipientLower.includes(nameLower);
      });
      if (match) {
        sub.entity_id = match.id;
      }
    }

    // For K-1s, link back to the issuing/filing entity as a related entity
    let relatedEntities: Array<Record<string, unknown>> = [];
    if (sub.k1_recipient && parentEntityId && parentEntityId !== sub.entity_id) {
      const parentEntity = entityList.find((e) => e.id === parentEntityId);
      relatedEntities = [{
        entity_id: parentEntityId,
        entity_name: parentEntity?.name || "Filing Entity",
        role: "related",
        confidence: "high",
        reason: "K-1 issued by this entity",
      }];
    }
    // For non-K-1 sub-documents (state returns, etc.), if entity_id differs from parent, link to parent
    if (!sub.k1_recipient && parentEntityId && sub.entity_id && sub.entity_id !== parentEntityId) {
      const parentEntity = entityList.find((e) => e.id === parentEntityId);
      relatedEntities = [{
        entity_id: parentEntityId,
        entity_name: parentEntity?.name || "Filing Entity",
        role: "related",
        confidence: "high",
        reason: "Sub-document from composite filing",
      }];
    }

    // Determine routing for each child
    const hasActions = sub.actions && sub.actions.length > 0;
    const hasEntity = !!sub.entity_id;
    const childRoute = hasActions ? "review_ready" : (hasEntity ? "extracted" : "review_ready");
    const childReason = hasActions ? "database_mutations" : (!hasEntity ? "no_match" : null);

    const { data: childItem } = await admin.from("document_queue").insert({
      batch_id: parentItem.batch_id,
      status: childRoute,
      original_filename: sub.suggested_name || `${parentItem.original_filename} (sub)`,
      file_path: parentItem.file_path,
      file_size: parentItem.file_size,
      mime_type: parentItem.mime_type,
      content_hash: parentItem.content_hash,
      parent_queue_id: parentItem.id,
      staged_doc_type: sub.document_type,
      staged_category: sub.document_category,
      staged_year: sub.year,
      staging_confidence: "ai",
      ai_document_type: sub.document_type,
      ai_document_category: sub.document_category,
      ai_entity_id: sub.entity_id,
      ai_year: sub.year,
      ai_direction: sub.direction,
      ai_jurisdiction: sub.jurisdiction,
      ai_page_range: sub.page_range,
      ai_k1_recipient: sub.k1_recipient,
      ai_suggested_name: sub.suggested_name,
      ai_summary: sub.summary,
      ai_proposed_actions: sub.actions,
      ai_related_entities: relatedEntities.length > 0 ? relatedEntities : null,
      ai_extraction: { actions: sub.actions, summary: sub.summary },
      entity_match_confidence: sub.entity_id ? "high" : "none",
      approval_reason: childReason,
      extraction_completed_at: new Date().toISOString(),
      source_type: "composite",
      source_ref: parentItem.id as string,
    }).select().single();

    // Auto-ingest children that don't need review
    if (childRoute === "extracted" && childItem) {
      const ingestResult = await ingestQueueItem({
        item: childItem,
        orgId: batchOrgId,
        applyMutations: false,
        finalStatus: "auto_ingested",
      });
      if (!ingestResult.success) {
        await admin
          .from("document_queue")
          .update({ status: "review_ready", approval_reason: "auto_ingest_failed" })
          .eq("id", childItem.id);
      }
    }
  }));
}

/**
 * Recalculate and update batch statistics.
 */
async function updateBatchStats(
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
  const anyReviewReady = items.some((i) => i.status === "review_ready");

  let batchStatus: string;
  if (allDone) batchStatus = "completed";
  else if (anyExtracting) batchStatus = "processing";
  else if (anyReviewReady) batchStatus = "review";
  else batchStatus = "staging";

  await admin
    .from("document_batches")
    .update({ ...stats, status: batchStatus })
    .eq("id", batchId);
}

/**
 * Process all queued items in a batch with concurrency control.
 * Fetches DB context once and shares it across all items.
 */
export async function processBatch(
  batchId: string,
  concurrency: number = 3
): Promise<void> {
  const admin = createAdminClient();

  // Get all queued items
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

  // Fetch batch org ID for scoped DB context
  const { data: batch } = await admin
    .from("document_batches")
    .select("organization_id")
    .eq("id", batchId)
    .single();

  // Pre-fetch DB context once for the entire batch (org-scoped)
  console.log(`[PIPELINE] Batch ${batchId}: fetching DB context for org ${batch?.organization_id}`);
  const dbContext = await getDbContext(admin, batch?.organization_id ?? undefined);
  console.log(`[PIPELINE] Batch ${batchId}: DB context ready`);

  // Process with semaphore-controlled concurrency
  const itemIds = items.map((i) => i.id);
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < itemIds.length) {
      const currentIndex = index++;
      const itemId = itemIds[currentIndex];
      try {
        await processQueueItem(itemId, dbContext);
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
}
