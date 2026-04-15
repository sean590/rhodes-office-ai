/**
 * Pipeline Worker v2 — Two-Tier Extraction
 *
 * Processing flow:
 * 1. Tier 1: Fast triage all items (Haiku, concurrency=10)
 * 2. Composite detection: split composite PDFs
 * 3. Mismatch handling: pause mismatched docs, continue matched
 * 4. Tier 2: Deep extraction on matched items (Sonnet, trimmed context, concurrency=5)
 * 5. Routing: auto-ingest or review queue
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  runTier1,
  buildEntityRoster,
  buildInvestmentRoster,
  processWithConcurrency,
  hasCompositeKeywords,
  scanDocumentStructure,
  isComposite,
} from "./triage";
import type { Tier1Result } from "./triage";
import { runTier2 } from "./extract-v2";
import { buildExtractionContext } from "@/lib/utils/chat-context";
import { processCompositeV2 } from "./composite-v2";
import { buildTriageSummary } from "./mismatch";
import { ingestQueueItem } from "./ingest";
import { invalidateDocumentTypeCache } from "@/lib/document-types";
import * as Sentry from "@sentry/nextjs";

const TIER1_CONCURRENCY = 10;
const TIER2_CONCURRENCY = 5;

interface QueueItemForProcessing {
  id: string;
  batch_id: string;
  original_filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  staged_doc_type: string | null;
  staged_entity_id: string | null;
  staged_year: number | null;
  staging_confidence: string | null;
  is_composite: boolean;
}

/**
 * Process a batch of queue items through the two-tier pipeline.
 */
export async function processBatchV2(
  batchId: string,
  orgId: string,
  userContext?: string,
  pageContext?: { entityId?: string; entityName?: string; investmentId?: string; investmentName?: string },
): Promise<{
  matched: number;
  mismatched: number;
  composites: number;
  errors: number;
  triageSummary: string;
}> {
  const admin = createAdminClient();

  // Fetch all queued items in this batch
  const { data: queueItems } = await admin
    .from("document_queue")
    .select("id, batch_id, original_filename, file_path, file_size, mime_type, staged_doc_type, staged_entity_id, staged_year, staging_confidence, is_composite")
    .eq("batch_id", batchId)
    .eq("status", "queued")
    .order("created_at");

  if (!queueItems || queueItems.length === 0) {
    return { matched: 0, mismatched: 0, composites: 0, errors: 0, triageSummary: "No documents to process." };
  }

  console.log(`[WORKER-V2] Processing batch ${batchId}: ${queueItems.length} items`);

  // Build rosters once for the batch
  const entityRoster = await buildEntityRoster(orgId);
  const investmentRoster = await buildInvestmentRoster(orgId);

  // Check for composite keywords in user context
  const compositeHint = userContext ? hasCompositeKeywords(userContext) : false;

  // =========================================
  // TIER 1: Fast triage (all items, parallel)
  // =========================================

  const tier1Tasks = queueItems.map((item) => async () => {
    try {
      // Update progress
      await admin.from("document_queue").update({
        status: "extracting",
        processing_step: "downloading",
        processing_progress: 5,
        extraction_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);

      // Download file
      const { data: fileData, error: downloadError } = await admin.storage
        .from("documents")
        .download(item.file_path);

      if (downloadError || !fileData) {
        throw new Error(`Download failed: ${downloadError?.message || "No data"}`);
      }

      const buffer = Buffer.from(await fileData.arrayBuffer());

      // Update progress
      await admin.from("document_queue").update({
        processing_step: "triage",
        processing_progress: 15,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);

      // Structural scan for composite detection (runs in parallel with tier 1)
      let structuralScan = null;
      if (item.mime_type === "application/pdf" && (compositeHint || item.is_composite)) {
        structuralScan = await scanDocumentStructure(buffer);
      }

      // Run tier 1 triage
      const triageResult = await runTier1(
        {
          buffer,
          filename: item.original_filename,
          mimeType: item.mime_type,
          userContext,
          pageContext: pageContext ? {
            entityId: pageContext.entityId,
            entityName: pageContext.entityName,
            investmentId: pageContext.investmentId,
            investmentName: pageContext.investmentName,
          } : undefined,
        },
        entityRoster,
        investmentRoster,
      );

      // If user already specified entity via staging, override triage
      if (item.staged_entity_id && item.staging_confidence === "user") {
        triageResult.entity_match = {
          id: item.staged_entity_id,
          name: triageResult.entity_match.name || "User-specified",
          confidence: "high",
          reasoning: "User-specified entity",
        };
      }

      // Composite detection (three-layer)
      const compositeResult = isComposite(
        compositeHint,
        structuralScan || { likely_composite: false, section_breaks: [], distinct_form_types: [], distinct_eins: [] },
        triageResult.is_composite,
        item.file_size > 500000 ? 80 : undefined, // rough page estimate
      );

      console.log(`[WORKER-V2] Tier 1 result for ${item.original_filename}: entity=${triageResult.entity_match.name || "none"} (${triageResult.entity_match.confidence}), type=${triageResult.document_type}, composite=${compositeResult.composite}`);

      return {
        item,
        buffer,
        triageResult,
        isComposite: compositeResult.composite,
        compositeConfidence: compositeResult.confidence,
      };
    } catch (err) {
      Sentry.captureException(err, { extra: { queueItemId: item.id, filename: item.original_filename } });
      console.error(`[WORKER-V2] Tier 1 failed for ${item.id}:`, err);

      await admin.from("document_queue").update({
        status: "error",
        processing_step: "triage",
        extraction_error: err instanceof Error ? err.message : "Triage failed",
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);

      return null;
    }
  });

  const tier1Results = (await processWithConcurrency(tier1Tasks, TIER1_CONCURRENCY)).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof tier1Tasks[0]>>>[];

  console.log(`[WORKER-V2] Tier 1 complete: ${tier1Results.length} triaged, ${queueItems.length - tier1Results.length} errors`);

  // Entity matching is now handled by Tier 2 (Sonnet with full org context).
  // Tier 1's entity_match is advisory only — used for triage summary display but not routing.

  // =========================================
  // COMPOSITE: Handle composite documents
  // =========================================

  const composites = tier1Results.filter((r) => r.isComposite);
  const nonComposites = tier1Results.filter((r) => !r.isComposite);

  for (const comp of composites) {
    try {
      await processCompositeV2(
        comp.item.id,
        comp.buffer,
        comp.triageResult.composite_sections,
        orgId,
        batchId,
        userContext,
      );

      // Mark parent as completed
      await admin.from("document_queue").update({
        status: "auto_ingested",
        processing_step: "completing",
        processing_progress: 100,
        ai_summary: `Composite document split into ${comp.triageResult.composite_sections.length} sub-documents`,
        updated_at: new Date().toISOString(),
      }).eq("id", comp.item.id);
    } catch (err) {
      console.error(`[WORKER-V2] Composite processing failed for ${comp.item.id}:`, err);
      await admin.from("document_queue").update({
        status: "error",
        extraction_error: err instanceof Error ? err.message : "Composite processing failed",
        updated_at: new Date().toISOString(),
      }).eq("id", comp.item.id);
    }
  }

  // =========================================
  // TIER 2: Deep extraction with full org context
  // =========================================
  // All non-composite documents go to Tier 2. Entity matching is handled by Tier 2
  // with full org context — Tier 1's entity_match is advisory only.

  // Build triage summary for progress display (uses Tier 1's advisory hints)
  const triageSummary = buildTriageSummary(
    nonComposites.map((r) => ({ filename: r.item.original_filename, result: r.triageResult })),
    [],
  );

  // Build full org context once for the entire batch (Anthropic prompt caching makes this efficient)
  const orgContext = await buildExtractionContext(orgId);
  console.log(`[WORKER-V2] Extraction context built: ${orgContext.length} chars`);

  // ALL non-composite items go to Tier 2
  const tier2Items = nonComposites;

  const tier2Tasks = tier2Items.map((triaged) => async () => {
    try {
      await admin.from("document_queue").update({
        processing_step: "extracting",
        processing_progress: 50,
        updated_at: new Date().toISOString(),
      }).eq("id", triaged.item.id);

      // Tier 2 with full org context — entity matching happens here
      const result = await runTier2(
        triaged.buffer,
        triaged.item.mime_type,
        triaged.item.original_filename,
        triaged.triageResult,
        orgContext,
        {
          userContext,
          entityDiscovery: true,
        },
      );

      // Tier 2 is now the authority for entity matching
      // Honor user-staged entity as override
      let resolvedEntityId = (triaged.item.staged_entity_id && triaged.item.staging_confidence === "user")
        ? triaged.item.staged_entity_id
        : result.entity_id || null;

      // Validate entity ID exists (Tier 2 shouldn't confuse investments for entities, but be safe)
      if (resolvedEntityId) {
        const { data: entityCheck } = await admin.from("entities").select("id").eq("id", resolvedEntityId).maybeSingle();
        if (!entityCheck) {
          console.log(`[WORKER-V2] Entity ID ${resolvedEntityId} from extraction not found in entities table, clearing`);
          resolvedEntityId = null;
        }
      }

      // Route: auto-ingest or review
      const hasActions = result.actions && result.actions.length > 0;
      const hasEntity = !!resolvedEntityId;
      const route = hasActions ? "review_ready" : (hasEntity ? "extracted" : "review_ready");
      const reason = hasActions ? "database_mutations" : (!hasEntity ? "no_match" : null);

      const { error: updateErr } = await admin.from("document_queue").update({
        status: route === "extracted" ? "extracted" : "review_ready",
        processing_step: "completing",
        processing_progress: 90,
        ai_extraction: {
          actions: result.actions,
          summary: result.summary,
          response_message: result.response_message,
          follow_up_questions: result.follow_up_questions,
          investment_id: triaged.triageResult.investment_match?.id || pageContext?.investmentId || null,
          context_mode: "full",
        },
        ai_summary: result.summary || null,
        ai_document_type: result.document_type || triaged.triageResult.document_type,
        ai_document_category: result.document_category || triaged.triageResult.document_category,
        ai_entity_id: resolvedEntityId,
        ai_year: result.year || triaged.triageResult.year,
        ai_direction: result.direction || null,
        ai_proposed_actions: result.actions || null,
        ai_suggested_name: result.suggested_name || null,
        ai_related_entities: result.related_entities || null,
        entity_match_confidence: result.entity_match_confidence || triaged.triageResult.entity_match.confidence,
        approval_reason: reason,
        extraction_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", triaged.item.id);
      if (updateErr) console.error(`[WORKER-V2] Queue item update FAILED for ${triaged.item.id}:`, updateErr);

      // Auto-ingest if no review needed
      if (route === "extracted") {
        console.log(`[WORKER-V2] Auto-ingesting ${triaged.item.original_filename}, entity=${resolvedEntityId}`);
        const { data: updatedItem, error: fetchErr } = await admin
          .from("document_queue")
          .select("*")
          .eq("id", triaged.item.id)
          .single();

        if (fetchErr) {
          console.error(`[WORKER-V2] Failed to fetch queue item for ingest:`, fetchErr);
        } else if (updatedItem) {
          const ingestResult = await ingestQueueItem({
            item: updatedItem,
            orgId,
            applyMutations: false,
            finalStatus: "auto_ingested",
          });

          if (!ingestResult.success) {
            await admin.from("document_queue").update({
              status: "review_ready",
              approval_reason: "auto_ingest_failed",
            }).eq("id", triaged.item.id);
          }
        }
      }

      // Final progress
      await admin.from("document_queue").update({
        processing_progress: 100,
        updated_at: new Date().toISOString(),
      }).eq("id", triaged.item.id);

    } catch (err) {
      Sentry.captureException(err, { extra: { queueItemId: triaged.item.id } });
      console.error(`[WORKER-V2] Tier 2 failed for ${triaged.item.id}:`, err);

      await admin.from("document_queue").update({
        status: "error",
        extraction_error: err instanceof Error ? err.message : "Extraction failed",
        processing_step: "extracting",
        updated_at: new Date().toISOString(),
      }).eq("id", triaged.item.id);
    }
  });

  await processWithConcurrency(tier2Tasks, TIER2_CONCURRENCY);

  // Update batch stats
  await updateBatchStats(admin, batchId);

  const errorCount = queueItems.length - tier1Results.length;
  console.log(`[WORKER-V2] Batch ${batchId} complete: ${tier2Items.length} processed, ${composites.length} composites, ${errorCount} errors`);

  return {
    matched: tier2Items.length,
    mismatched: 0,
    composites: composites.length,
    errors: errorCount,
    triageSummary,
  };
}

async function updateBatchStats(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
): Promise<void> {
  const { data: items } = await admin
    .from("document_queue")
    .select("status")
    .eq("batch_id", batchId);

  if (!items) return;

  const counts = {
    total: items.length,
    staged: items.filter((i) => i.status === "staged").length,
    queued: items.filter((i) => i.status === "queued").length,
    extracting: items.filter((i) => i.status === "extracting").length,
    review_ready: items.filter((i) => i.status === "review_ready").length,
    approved: items.filter((i) => i.status === "approved").length,
    auto_ingested: items.filter((i) => i.status === "auto_ingested" || i.status === "extracted").length,
    error: items.filter((i) => i.status === "error").length,
    rejected: items.filter((i) => i.status === "rejected").length,
  };

  const isComplete = counts.queued === 0 && counts.extracting === 0 && counts.staged === 0;
  const status = isComplete
    ? (counts.review_ready > 0 ? "review" : "completed")
    : "processing";

  await admin.from("document_batches").update({
    total_documents: counts.total,
    staged_count: counts.staged,
    queued_count: counts.queued,
    approved_count: counts.approved + counts.auto_ingested,
    error_count: counts.error,
    status,
    updated_at: new Date().toISOString(),
  }).eq("id", batchId);
}
