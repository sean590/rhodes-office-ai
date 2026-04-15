/**
 * Composite Document Processing (v2)
 * Splits composite PDFs into sub-documents, runs tier 1 triage on each,
 * then tier 2 deep extraction with trimmed entity context.
 * Parallel processing across sub-documents for speed.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { extractPageRange, analyzePdf } from "./pdf-processor";
import { runTier1, processWithConcurrency, buildEntityRoster, buildInvestmentRoster, scanDocumentStructure } from "./triage";
import type { Tier1Result } from "./triage";
import { runTier2 } from "./extract-v2";
import { buildExtractionContext } from "@/lib/utils/chat-context";
import { ingestQueueItem } from "./ingest";

const TIER1_CONCURRENCY = 10;
const TIER2_CONCURRENCY = 5;

interface CompositeSection {
  estimated_page_range: [number, number];
  type_hint: string;
}

/**
 * Process a composite document through the two-tier pipeline.
 * 1. Split PDF into sub-documents based on tier 1 section detection
 * 2. Run tier 1 on each sub-document (fast, parallel)
 * 3. Group sub-documents by entity
 * 4. Run tier 2 on each group (parallel, trimmed context)
 * 5. Create child queue items for each sub-document
 */
export async function processCompositeV2(
  parentItemId: string,
  buffer: Buffer,
  sections: CompositeSection[],
  orgId: string,
  batchId: string,
  userContext?: string,
): Promise<void> {
  const admin = createAdminClient();

  // If no sections detected, try structural scan to find them
  let resolvedSections = sections;
  if (resolvedSections.length === 0) {
    const scan = await scanDocumentStructure(buffer);
    if (scan.section_breaks.length > 0) {
      // Build sections from breaks
      const pdfAnalysis = await analyzePdf(buffer, null);
      const breaks = [1, ...scan.section_breaks.map(b => b.page), pdfAnalysis.page_count + 1];
      resolvedSections = [];
      for (let i = 0; i < breaks.length - 1; i++) {
        resolvedSections.push({
          estimated_page_range: [breaks[i], breaks[i + 1] - 1] as [number, number],
          type_hint: scan.distinct_form_types[i] || "unknown",
        });
      }
    } else {
      // No sections found — can't split, treat as single document
      console.log(`[COMPOSITE] ${parentItemId}: no sections detected, skipping composite split`);
      return;
    }
  }

  console.log(`[COMPOSITE] ${parentItemId}: splitting into ${resolvedSections.length} sub-documents`);

  // Step 1: Split PDF into sub-document buffers
  const subDocBuffers: Array<{ buffer: Buffer; section: CompositeSection; index: number }> = [];
  for (let i = 0; i < resolvedSections.length; i++) {
    const section = resolvedSections[i];
    try {
      const subBuffer = await extractPageRange(buffer, [section.estimated_page_range]);
      subDocBuffers.push({ buffer: subBuffer, section, index: i });
    } catch (err) {
      console.error(`[COMPOSITE] ${parentItemId}: failed to split section ${i}:`, err);
    }
  }

  if (subDocBuffers.length === 0) {
    console.error(`[COMPOSITE] ${parentItemId}: no sub-documents extracted`);
    return;
  }

  // Step 2: Tier 1 triage each sub-document (fast, parallel)
  const entityRoster = await buildEntityRoster(orgId);
  const investmentRoster = await buildInvestmentRoster(orgId);

  const { data: parentItem } = await admin
    .from("document_queue")
    .select("original_filename")
    .eq("id", parentItemId)
    .single();
  const parentFilename = parentItem?.original_filename || "document";

  const tier1Tasks = subDocBuffers.map((sub) => async () => {
    const filename = `${parentFilename}_pages_${sub.section.estimated_page_range[0]}-${sub.section.estimated_page_range[1]}`;
    const result = await runTier1(
      {
        buffer: sub.buffer,
        filename,
        mimeType: "application/pdf",
        userContext,
      },
      entityRoster,
      investmentRoster,
    );
    return { ...sub, triageResult: result, filename };
  });

  const triaged = await processWithConcurrency(tier1Tasks, TIER1_CONCURRENCY);
  console.log(`[COMPOSITE] ${parentItemId}: tier 1 triage complete for ${triaged.length} sub-docs`);

  // Step 3: Build full org context once for all sub-docs
  const orgContext = await buildExtractionContext(orgId);

  // Step 4: Tier 2 deep extraction (parallel)
  const tier2Tasks = triaged.map((sub) => async () => {
    try {
      const extractionResult = await runTier2(
        sub.buffer,
        "application/pdf",
        sub.filename,
        sub.triageResult,
        orgContext,
        { userContext, entityDiscovery: true },
      );

        // Create child queue item
        const childStatus = extractionResult?.actions && extractionResult.actions.length > 0
          ? "review_ready"
          : sub.triageResult.entity_match.id
            ? "extracted"
            : "review_ready";

        const childReason = extractionResult?.actions && extractionResult.actions.length > 0
          ? "database_mutations"
          : !sub.triageResult.entity_match.id
            ? "no_match"
            : null;

        const { data: childItem } = await admin.from("document_queue").insert({
          batch_id: batchId,
          status: childStatus,
          original_filename: extractionResult?.suggested_name || sub.filename,
          file_path: (await admin.from("document_queue").select("file_path").eq("id", parentItemId).single()).data?.file_path,
          file_size: sub.buffer.length,
          mime_type: "application/pdf",
          parent_queue_id: parentItemId,
          staged_doc_type: sub.triageResult.document_type,
          staged_category: sub.triageResult.document_category,
          staged_year: sub.triageResult.year,
          staging_confidence: "ai",
          ai_document_type: extractionResult?.document_type || sub.triageResult.document_type,
          ai_document_category: extractionResult?.document_category || sub.triageResult.document_category,
          ai_entity_id: extractionResult?.entity_id || sub.triageResult.entity_match.id,
          ai_year: extractionResult?.year || sub.triageResult.year,
          ai_direction: extractionResult?.direction || null,
          ai_page_range: sub.section.estimated_page_range,
          ai_suggested_name: extractionResult?.suggested_name || null,
          ai_summary: extractionResult?.summary || null,
          ai_proposed_actions: extractionResult?.actions || null,
          ai_extraction: extractionResult ? { actions: extractionResult.actions, summary: extractionResult.summary } : null,
          entity_match_confidence: sub.triageResult.entity_match.confidence,
          approval_reason: childReason,
          extraction_completed_at: new Date().toISOString(),
          source_type: "composite",
          source_ref: parentItemId,
          processing_step: "completing",
          processing_progress: 95,
        }).select().single();

        // Auto-ingest children that don't need review
        if (childStatus === "extracted" && childItem) {
          await ingestQueueItem({
            item: childItem,
            orgId,
            applyMutations: false,
            finalStatus: "auto_ingested",
          });
        }
    } catch (err) {
      console.error(`[COMPOSITE] ${parentItemId}: tier 2 failed for sub-doc ${sub.filename}:`, err);

      await admin.from("document_queue").insert({
        batch_id: batchId,
        status: "error",
        original_filename: sub.filename,
        file_path: "",
        parent_queue_id: parentItemId,
        extraction_error: err instanceof Error ? err.message : "Unknown error",
        source_type: "composite",
      });
    }
  });

  await processWithConcurrency(tier2Tasks, TIER2_CONCURRENCY);

  console.log(`[COMPOSITE] ${parentItemId}: composite processing complete (${triaged.length} sub-docs)`);
}
