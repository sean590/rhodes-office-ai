/**
 * Shared ingest logic — creates a document record from a queue item,
 * moves the file to permanent storage, optionally applies proposed actions.
 *
 * Used by: auto-ingest (worker), approve endpoint, ingest-only endpoint, approve-all endpoint.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { applyActions } from "@/lib/pipeline/apply";
import { assertNoDbError, logDbError } from "./db-errors";
import { generateDocumentFilename, getExtension, getCategoryForDocType } from "@/lib/utils/document-naming";
import { checkAndSatisfyExpectations } from "@/lib/utils/document-expectations";
import { runEntityInference, upsertRecurrenceSignal, reevaluateRecurrenceExpectations } from "@/lib/utils/inference-engine";
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

    // Determine investment_id — check AI proposed actions, extraction result, then page context
    let investmentId: string | null = null;
    const aiActions = item.ai_proposed_actions as Array<{ action: string; data: Record<string, unknown> }> | null;
    if (aiActions) {
      const linkAction = aiActions.find((a) => a.action === "link_document_to_investment");
      if (linkAction?.data?.investment_id) {
        investmentId = linkAction.data.investment_id as string;
      }
    }
    if (!investmentId) {
      const extraction = item.ai_extraction as Record<string, unknown> | null;
      if (extraction?.investment_id) {
        investmentId = extraction.investment_id as string;
      }
    }

    console.log(`[INGEST] Document ${item.original_filename}: entity=${finalEntityId}, investment=${investmentId}, ai_extraction_keys=${Object.keys((item.ai_extraction as Record<string, unknown>) || {}).join(",")}`);

    // Create or update document record.
    // If the queue item already has a document_id (created at registration time
    // with status='processing'), UPDATE that row with extraction results and
    // set status='ready'. Otherwise INSERT a new row (legacy path, edge cases).
    const docName = (item.ai_suggested_name || item.original_filename) as string;
    const docFields = {
      entity_id: finalEntityId,
      investment_id: investmentId,
      name: docName,
      document_type: finalDocType,
      document_category: finalCategory,
      year: finalYear,
      file_path: finalPath,
      file_size: item.file_size,
      mime_type: item.mime_type,
      content_hash: item.content_hash,
      direction: finalDirection,
      jurisdiction: item.ai_jurisdiction || null,
      source_page_range: item.ai_page_range || null,
      k1_recipient: item.ai_k1_recipient || null,
      ai_extracted: true,
      ai_extraction: item.ai_extraction,
      ai_extracted_at: item.extraction_completed_at || new Date().toISOString(),
      status: "ready",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let doc: Record<string, any> | null = null;
    if (item.document_id) {
      const { error: updateErr } = await admin
        .from("documents")
        .update(docFields)
        .eq("id", item.document_id);
      if (updateErr) {
        console.error("Document update failed:", updateErr.message, { document_id: item.document_id });
        return { success: false, error: `Failed to update document: ${updateErr.message}` };
      }
      doc = { id: item.document_id as string, ...docFields };
    } else {
      const { data: newDoc, error: docError } = await admin
        .from("documents")
        .insert({
          ...docFields,
          uploaded_by: userId,
          organization_id: orgId,
        })
        .select()
        .single();
      if (docError) {
        console.error("Document insert failed:", docError.message, { finalEntityId, finalDocType, finalCategory });
        return { success: false, error: `Failed to create document: ${docError.message}` };
      }
      doc = newDoc;
    }

    if (!doc) return { success: false, error: "Document record not created" };

    // If composite child, link to parent document
    if (item.parent_queue_id) {
      const { data: parentItem } = await admin
        .from("document_queue")
        .select("document_id")
        .eq("id", item.parent_queue_id)
        .single();
      if (parentItem?.document_id) {
        const { error } = await admin
          .from("documents")
          .update({ source_document_id: parentItem.document_id })
          .eq("id", doc.id);
        logDbError(error, `link composite child doc ${doc.id} to parent`);
      }
    }

    // Apply proposed actions (if enabled)
    let actionsApplied = 0;
    let actionsFailed = 0;

    if (applyMutations) {
      const actions = (item.ai_proposed_actions || []) as Array<{ action: string; data: Record<string, unknown> }>;
      if (actions.length > 0) {
        const { results, firstCreatedEntityId, createdEntityIds } = await applyActions(actions, {
          documentId: doc.id,
          existingEntityId: finalEntityId || undefined,
          orgId,
        });

        if (!finalEntityId && firstCreatedEntityId) {
          // Invariant: actions just created an entity for this doc, so the
          // doc row must point to it. A silent failure here leaves the doc
          // unowned despite a fresh entity being attached via actions.
          const { error } = await admin
            .from("documents")
            .update({ entity_id: firstCreatedEntityId })
            .eq("id", doc.id);
          assertNoDbError(error, `attach created entity ${firstCreatedEntityId} to doc ${doc.id}`);
        }

        // Create entity links for ALL created entities (umbrella documents).
        // Awaited (was fire-and-forget) so we can surface DB errors. The
        // upserts are fast and run sequentially per doc — no perf concern.
        for (const createdId of createdEntityIds) {
          const isPrimary = createdId === firstCreatedEntityId && !finalEntityId;
          const { error } = await admin.from("document_entity_links").upsert({
            document_id: doc.id,
            entity_id: createdId,
            organization_id: orgId,
            role: isPrimary ? "primary" : "related",
            source: "ai",
            confidence: 1.0,
            ai_reason: "Entity created from this document",
            created_by: userId,
          }, { onConflict: "document_id,entity_id" });
          logDbError(error, `link doc ${doc.id} to created entity ${createdId}`);
        }

        actionsApplied = results.filter((r) => r.success).length;
        actionsFailed = results.filter((r) => !r.success).length;

        // Mark actions as applied on the document so the entity page doesn't
        // re-prompt. Best-effort — UI re-prompts are annoying but recoverable.
        if (actionsApplied > 0) {
          const currentExtraction = (doc.ai_extraction || {}) as Record<string, unknown>;
          const allIndices = actions.map((_, i) => i);
          const { error } = await admin
            .from("documents")
            .update({
              ai_extraction: {
                ...currentExtraction,
                applied: true,
                applied_indices: allIndices,
              },
            })
            .eq("id", doc.id);
          logDbError(error, `mark actions applied on doc ${doc.id}`);
        }
      }
    }

    // Create document-entity links. Was fire-and-forget via `.then(() => {})`
    // which fully silenced errors; now awaited so logDbError can surface them.
    // 1. Primary link
    if (finalEntityId) {
      const { error } = await admin.from("document_entity_links").upsert({
        document_id: doc.id,
        entity_id: finalEntityId,
        organization_id: orgId,
        role: "primary",
        source: "ai",
        confidence: 1.0,
        created_by: userId,
      }, { onConflict: "document_id,entity_id" });
      logDbError(error, `primary link doc ${doc.id} → entity ${finalEntityId}`);
    }

    // 2. Secondary links from AI extraction
    const relatedEntities = (item.ai_related_entities || []) as Array<{
      entity_id: string; role: string; confidence: string; reason: string;
    }>;
    for (const ref of relatedEntities) {
      if (ref.entity_id && ref.entity_id !== finalEntityId) {
        const { error } = await admin.from("document_entity_links").upsert({
          document_id: doc.id,
          entity_id: ref.entity_id,
          organization_id: orgId,
          role: ref.role || "related",
          source: "ai",
          confidence: ref.confidence === "high" ? 0.9 : ref.confidence === "medium" ? 0.7 : 0.5,
          ai_reason: ref.reason,
          created_by: userId,
        }, { onConflict: "document_id,entity_id" });
        logDbError(error, `related link doc ${doc.id} → entity ${ref.entity_id}`);
      }
    }

    // Check document completeness expectations (includes linked entities)
    const hasLinkedEntities = doc.entity_id || relatedEntities.length > 0;
    if (hasLinkedEntities) {
      await checkAndSatisfyExpectations(doc.id).catch(() => {});
      // Run inference engine (non-blocking) for primary entity
      if (doc.entity_id) {
        runEntityInference(orgId, doc.entity_id).catch(() => {});
      }
    }

    // Process termination signals from extraction
    const terminationSignals = (item.ai_extraction as Record<string, unknown>)?.termination_signals as Array<{
      signal_type: string; entity_id: string; related_entity_name: string | null;
      related_entity_id: string | null; jurisdiction: string | null;
      effective_date: string | null; document_types_affected: string[];
      confidence: string; reason: string;
    }> | undefined;
    if (terminationSignals && terminationSignals.length > 0) {
      for (const signal of terminationSignals) {
        await upsertRecurrenceSignal(orgId, doc.id, signal).catch((err) => {
          console.error("Termination signal upsert error:", err);
        });
      }
      // Re-evaluate existing expectations that might now be suppressed
      const affectedEntityIds = new Set(terminationSignals.map((s) => s.entity_id));
      for (const eid of affectedEntityIds) {
        await reevaluateRecurrenceExpectations(orgId, eid).catch((err) => {
          console.error("Reevaluate recurrence error:", err);
        });
      }
    }

    // Update queue item — terminal status transition. A silent failure here
    // leaves the queue row in 'review_ready'/'extracted' despite the document
    // being created and actions applied; the user sees the same item to
    // approve again. Throw so the outer try/catch returns success: false and
    // callers (worker auto-ingest, approve endpoint) react.
    {
      const { error } = await admin
        .from("document_queue")
        .update({
          status: finalStatus,
          document_id: doc.id,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      assertNoDbError(error, `${item.id}: terminal queue update to ${finalStatus}`);
    }

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
