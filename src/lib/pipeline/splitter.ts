/**
 * Document splitter — single helper for both upload-driven (worker) and
 * chat-driven (split_document tool) splitting.
 *
 * See CLAUDE-CODE-PIPELINE-UNIFICATION.md for context. The big idea: this
 * helper does ONLY splitting (extract page ranges, upload, enqueue children)
 * — no extraction. Children land in document_queue with status="queued" and
 * a split_context payload, and the worker picks them up like any other queue
 * item. That's how we get one pipeline instead of three.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { extractPageRange } from "./pdf-processor";

type Admin = ReturnType<typeof createAdminClient>;

/** Recursion limit. Spec: 0 = upload, 1 = first split, 2 = deepest leaf.
 *  At depth >= MAX_SPLIT_DEPTH the splitter refuses; the parent gets
 *  extracted as a leaf even if extraction reports is_composite. */
export const MAX_SPLIT_DEPTH = 2;

export interface SplitSection {
  /** 1-indexed inclusive page range, mirrors extractPageRange's contract. */
  page_range: [number, number];
  type_hint?: string;
  /** Pre-identified entity for this section (e.g., the recipient investor
   *  whose partner name appears on this page). When set, the splitter
   *  writes ai_entity_id and staged_entity_id on the child queue item, so
   *  extraction doesn't have to re-derive the assignment. Set by the
   *  document agent (via split_document tool) after it verifies the
   *  per-page investor mapping against the active investor list. */
  entity_id?: string;
}

/**
 * Minimal context threaded to a split child. Deliberately small: an empirical
 * test showed that padding child prompts with the parent's page-1 text,
 * "section X of N" framing, and the parent extraction's per-section pick
 * actively HURT accuracy — the model misallocated investors that it correctly
 * identified when given the same physical bytes with no parent baggage. See
 * feedback memory `less prompt context`. The child reads its own page; we
 * only thread metadata it can't infer from one page (which fund, which
 * candidate investors, the user's framing).
 */
export interface SplitContext {
  parent_queue_id: string;
  user_context: string | null;
  known_investment_id: string | null;
  known_entity_ids: string[];
  split_reason: "structural" | "per_investor_hint" | "model_composite";
}

interface ParentRow {
  id: string;
  batch_id: string;
  original_filename: string;
  split_depth: number;
}

interface ChildRow {
  id: string;
  batch_id: string;
  parent_queue_id: string;
  file_path: string;
  split_depth: number;
}

export interface SplitOpts {
  parentItem: ParentRow;
  parentBuffer: Buffer;
  sections: SplitSection[];
  splitReason: SplitContext["split_reason"];
  orgId: string;
  userContext?: string | null;
  knownInvestmentId?: string | null;
  knownEntityIds?: string[];
}

export interface SplitResult {
  children: ChildRow[];
  /** Set when the splitter refused to act. "max_depth" = parent already at
   *  the recursion cap. Caller should treat the parent as a leaf instead. */
  skipped: "max_depth" | null;
}

/**
 * Extract page ranges from the parent PDF, upload each to its own storage
 * path, and create child queue items in status="queued". Children carry
 * split_depth + split_context so the worker has the same parent signal the
 * upload pipeline normally produces.
 */
export async function splitDocumentIntoChildren(
  admin: Admin,
  opts: SplitOpts,
): Promise<SplitResult> {
  const { parentItem, parentBuffer, sections, splitReason, orgId } = opts;

  if (parentItem.split_depth >= MAX_SPLIT_DEPTH) {
    console.log(
      `[SPLITTER] ${parentItem.id}: refusing split — already at split_depth=${parentItem.split_depth} ` +
        `(max ${MAX_SPLIT_DEPTH}). Parent will be treated as a leaf.`,
    );
    return { children: [], skipped: "max_depth" };
  }

  if (sections.length === 0) {
    return { children: [], skipped: null };
  }

  const childDepth = parentItem.split_depth + 1;
  const children: ChildRow[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    // Extract bytes for this section. Failures here are per-section: log
    // and skip, so a bad page in the middle of a PDF doesn't kill the
    // whole split.
    let sectionBuffer: Buffer;
    try {
      sectionBuffer = await extractPageRange(parentBuffer, [section.page_range]);
    } catch (err) {
      console.error(
        `[SPLITTER] ${parentItem.id}: failed to extract pages ${section.page_range[0]}-${section.page_range[1]} for section ${i}:`,
        err,
      );
      continue;
    }

    // Section name for storage + queue display. Default to a page-range slug
    // so children are at least browseable when type_hint is absent.
    const sectionSlug =
      section.type_hint?.replace(/[^a-zA-Z0-9\-_. ]/g, "_") ||
      `pages-${section.page_range[0]}-${section.page_range[1]}`;
    const filename = `${parentItem.original_filename.replace(/\.pdf$/i, "")} - ${sectionSlug}.pdf`;
    const storagePath = `${orgId}/queue/${parentItem.batch_id}/split/${parentItem.id}/${i}-${sectionSlug}.pdf`;

    const { error: uploadErr } = await admin.storage
      .from("documents")
      .upload(storagePath, sectionBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      console.error(
        `[SPLITTER] ${parentItem.id}: upload failed for section ${i} → ${storagePath}:`,
        uploadErr.message,
      );
      // Insert an error queue item so the section is visible in /review
      // rather than silently disappearing.
      await admin.from("document_queue").insert({
        batch_id: parentItem.batch_id,
        status: "error",
        original_filename: filename,
        file_path: "",
        parent_queue_id: parentItem.id,
        split_depth: childDepth,
        extraction_error: `Failed to upload split section: ${uploadErr.message}`,
        source_type: "composite",
        source_ref: parentItem.id,
      });
      continue;
    }

    const splitContext: SplitContext = {
      parent_queue_id: parentItem.id,
      user_context: opts.userContext ?? null,
      known_investment_id: opts.knownInvestmentId ?? null,
      known_entity_ids: opts.knownEntityIds ?? [],
      split_reason: splitReason,
    };

    // Create a documents row up-front (status='processing') so the child
    // has a stable document_id the document-agent's write tools can target.
    // Without this, the agent gets queueItem.document_id=null, can't call
    // link_document_to_*, and either defers ("document not found") or
    // hallucinates split_document on a single-page PDF. Mirrors what the
    // /upload route does for top-level uploads. Pre-fills entity_id from
    // the verified per-section assignment (when caller supplied it) so the
    // doc shows up in the right entity's view immediately.
    const { data: docRow, error: docErr } = await admin
      .from("documents")
      .insert({
        organization_id: orgId,
        entity_id: section.entity_id ?? null,
        name: filename,
        document_type: section.type_hint || "other",
        file_path: storagePath,
        file_size: sectionBuffer.length,
        mime_type: "application/pdf",
        ai_extracted: false,
        status: "processing",
      })
      .select("id")
      .single();
    if (docErr || !docRow) {
      console.error(
        `[SPLITTER] ${parentItem.id}: document insert failed for section ${i}:`,
        docErr?.message,
      );
      continue;
    }

    const { data: child, error: insertErr } = await admin
      .from("document_queue")
      .insert({
        batch_id: parentItem.batch_id,
        status: "queued",
        original_filename: filename,
        file_path: storagePath,
        file_size: sectionBuffer.length,
        mime_type: "application/pdf",
        document_id: docRow.id,
        parent_queue_id: parentItem.id,
        split_depth: childDepth,
        split_context: splitContext,
        source_type: "composite",
        source_ref: parentItem.id,
        // Pre-identified entity from the splitter's caller (agent verified
        // the per-page investor mapping). Written to both ai_entity_id
        // (the effective entity for filing/display) and staged_entity_id
        // (the user-corrected layer that takes precedence in the approve
        // flow) so extraction's entity-matching step becomes a confirmation,
        // not a re-derivation.
        ai_entity_id: section.entity_id ?? null,
        staged_entity_id: section.entity_id ?? null,
      })
      .select("id, batch_id, parent_queue_id, file_path, split_depth")
      .single();

    if (insertErr || !child) {
      console.error(
        `[SPLITTER] ${parentItem.id}: queue insert failed for section ${i}:`,
        insertErr?.message,
      );
      continue;
    }

    children.push(child as ChildRow);
  }

  console.log(
    `[SPLITTER] ${parentItem.id}: created ${children.length}/${sections.length} children at split_depth=${childDepth} ` +
      `(reason: ${splitReason}).`,
  );

  // Kick off worker extraction for each child. Without this, children land in
  // status="queued" and nothing picks them up — the old processCompositeV2
  // path did inline extraction, but the new design is "splitter enqueues,
  // worker processes."
  //
  // Wrapped in next/server's after() so the child runs persist past the
  // parent's HTTP response. Without after(), Vercel suspends the function
  // the moment the parent returns; the bare-Promise version stranded
  // children in status="staged" forever (the 9 stuck "Split: ..." rows the
  // user hit in production were exactly this). after() extends the runtime
  // up to the function's maxDuration — long enough for sequential child
  // agent runs.
  //
  // Dynamic import avoids the circular module ref (worker imports splitter
  // for the composite branch).
  if (children.length > 0) {
    const { processQueueItem } = await import("./worker");
    const { after } = await import("next/server");
    for (const child of children) {
      after(
        processQueueItem(child.id).catch((err) => {
          console.error(
            `[SPLITTER] ${parentItem.id}: kickoff failed for child ${child.id}:`,
            err instanceof Error ? err.message : err,
          );
        }),
      );
    }
  }

  return { children, skipped: null };
}
