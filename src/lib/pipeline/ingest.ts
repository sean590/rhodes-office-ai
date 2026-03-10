/**
 * Shared ingest logic — creates a document record from a queue item,
 * moves the file to permanent storage, optionally applies proposed actions.
 *
 * Used by: auto-ingest (worker), approve endpoint, ingest-only endpoint, approve-all endpoint.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { applyActions } from "@/lib/pipeline/apply";
import { generateDocumentFilename, getExtension, getCategoryForDocType } from "@/lib/utils/document-naming";
import { checkAndSatisfyExpectations } from "@/lib/utils/document-expectations";
import type { DocumentCategory } from "@/lib/types/entities";

export interface IngestOptions {
  /** The queue item (full row from document_queue) */
  item: Record<string, unknown>;
  /** User ID for uploaded_by/reviewed_by (null-safe for FK constraint) */
  userId?: string | null;
  /** Organization ID for the document */
  orgId: string;
  /** Whether to apply ai_proposed_actions (false for ingest-only) */
  applyMutations?: boolean;
  /** Status to set on the queue item after ingestion */
  finalStatus?: "approved" | "auto_ingested";
}

export interface IngestResult {
  success: boolean;
  document?: Record<string, unknown>;
  error?: string;
  actions_applied?: number;
  actions_failed?: number;
}

export async function ingestQueueItem(options: IngestOptions): Promise<IngestResult> {
  const { item, userId = null, orgId, applyMutations = true, finalStatus = "approved" } = options;
  const admin = createAdminClient();

  try {
    // Determine final values (AI overrides staging)
    const finalEntityId = (item.ai_entity_id || item.staged_entity_id || null) as string | null;
    const finalDocType = (item.ai_document_type || item.staged_doc_type || "other") as string;
    const finalCategory = (item.ai_document_category || item.staged_category || getCategoryForDocType(finalDocType)) as DocumentCategory;
    const finalYear = (item.ai_year || item.staged_year || null) as number | null;
    const finalDirection = (item.ai_direction || null) as string | null;

    // Get entity info for naming
    let shortName: string | null = null;
    if (finalEntityId) {
      const { data: ent } = await admin
        .from("entities")
        .select("short_name")
        .eq("id", finalEntityId)
        .single();
      shortName = ent?.short_name || null;
    }

    // Generate canonical filename
    const extension = getExtension(item.mime_type as string, item.original_filename as string);
    const canonicalName = generateDocumentFilename(
      shortName, finalCategory, finalDocType, finalYear, extension, 0
    );

    // Move (or copy for composite children) file from queue/ to permanent storage
    const folder = finalEntityId || "unassociated";
    const permanentPath = `${folder}/${canonicalName}`;
    const isCompositeChild = !!item.parent_queue_id;

    let finalPath = permanentPath;
    if (isCompositeChild) {
      const { error: copyError } = await admin.storage
        .from("documents")
        .copy(item.file_path as string, permanentPath);
      if (copyError) finalPath = item.file_path as string;
    } else {
      const { error: moveError } = await admin.storage
        .from("documents")
        .move(item.file_path as string, permanentPath);
      if (moveError) {
        if (moveError.message?.includes("already exists")) {
          const fallbackPath = `${folder}/${canonicalName.replace(extension, "")}_${Date.now()}${extension}`;
          const { error: retryError } = await admin.storage
            .from("documents")
            .move(item.file_path as string, fallbackPath);
          finalPath = retryError ? (item.file_path as string) : fallbackPath;
        } else {
          finalPath = item.file_path as string;
        }
      }
    }

    // Create document record
    const docName = (item.ai_suggested_name || item.original_filename) as string;
    const { data: doc, error: docError } = await admin
      .from("documents")
      .insert({
        entity_id: finalEntityId,
        name: docName,
        document_type: finalDocType,
        document_category: finalCategory,
        year: finalYear,
        file_path: finalPath,
        file_size: item.file_size,
        mime_type: item.mime_type,
        uploaded_by: userId,
        content_hash: item.content_hash,
        direction: finalDirection,
        jurisdiction: item.ai_jurisdiction || null,
        source_page_range: item.ai_page_range || null,
        k1_recipient: item.ai_k1_recipient || null,
        organization_id: orgId,
        ai_extracted: true,
        ai_extraction: item.ai_extraction,
        ai_extracted_at: item.extraction_completed_at || new Date().toISOString(),
      })
      .select()
      .single();

    if (docError) {
      console.error("Document insert failed:", docError.message, { finalEntityId, finalDocType, finalCategory });
      return { success: false, error: `Failed to create document: ${docError.message}` };
    }

    // If composite child, link to parent document
    if (item.parent_queue_id) {
      const { data: parentItem } = await admin
        .from("document_queue")
        .select("document_id")
        .eq("id", item.parent_queue_id)
        .single();
      if (parentItem?.document_id) {
        await admin
          .from("documents")
          .update({ source_document_id: parentItem.document_id })
          .eq("id", doc.id);
      }
    }

    // Apply proposed actions (if enabled)
    let actionsApplied = 0;
    let actionsFailed = 0;

    if (applyMutations) {
      const actions = (item.ai_proposed_actions || []) as Array<{ action: string; data: Record<string, unknown> }>;
      if (actions.length > 0) {
        const { results, firstCreatedEntityId } = await applyActions(actions, {
          documentId: doc.id,
          existingEntityId: finalEntityId || undefined,
          orgId,
        });

        if (!finalEntityId && firstCreatedEntityId) {
          await admin
            .from("documents")
            .update({ entity_id: firstCreatedEntityId })
            .eq("id", doc.id);
        }

        actionsApplied = results.filter((r) => r.success).length;
        actionsFailed = results.filter((r) => !r.success).length;

        // Mark actions as applied on the document so the entity page doesn't re-prompt
        if (actionsApplied > 0) {
          const currentExtraction = (doc.ai_extraction || {}) as Record<string, unknown>;
          const allIndices = actions.map((_, i) => i);
          await admin
            .from("documents")
            .update({
              ai_extraction: {
                ...currentExtraction,
                applied: true,
                applied_indices: allIndices,
              },
            })
            .eq("id", doc.id);
        }
      }
    }

    // Check document completeness expectations
    if (doc.entity_id) {
      await checkAndSatisfyExpectations(doc.id).catch(() => {});
    }

    // Update queue item
    await admin
      .from("document_queue")
      .update({
        status: finalStatus,
        document_id: doc.id,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    return {
      success: true,
      document: doc,
      actions_applied: actionsApplied,
      actions_failed: actionsFailed,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Ingest error:", msg);
    return { success: false, error: msg };
  }
}
