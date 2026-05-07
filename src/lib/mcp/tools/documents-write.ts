/**
 * Document-domain write tools.
 *
 * link_document_to_entity, link_document_to_investment,
 * unlink_document, archive_document, update_document,
 * add_document_expectation, dismiss_document_expectation,
 * accept_document_suggestion.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { verifyResourceOwnership } from "../ownership";
import { dispatchAction } from "../apply-dispatch";
import { resolveName } from "../resolve-names";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import type { DocumentCategory } from "@/lib/types/entities";

function humanizeDocType(slug: string): string {
  return (
    DOCUMENT_TYPE_LABELS[slug] ||
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function humanizeCategory(slug: string): string {
  return DOCUMENT_CATEGORY_LABELS[slug as DocumentCategory] || slug;
}

const UPDATE_DOC_FIELD_LABEL: Record<string, string> = {
  name: "name",
  document_type: "type",
  document_category: "category",
  year: "year",
  jurisdiction: "jurisdiction",
};

export const linkDocumentToEntityTool = defineTool({
  name: "link_document_to_entity",
  description: "Link a document to an entity by setting documents.entity_id.",
  kind: "write",
  inputSchema: z.object({
    document_id: z.string().uuid(),
    entity_id: z.string().uuid(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const [docName, entityName] = await Promise.all([
      resolveName(ctx, "document", input.document_id),
      resolveName(ctx, "entity", input.entity_id),
    ]);
    return { summary: `Link "${docName}" to ${entityName}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "link_document_to_entity", {
      document_id: input.document_id,
      entity_id: input.entity_id,
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const linkDocumentToInvestmentTool = defineTool({
  name: "link_document_to_investment",
  description: "Link a document to an investment by setting documents.investment_id.",
  kind: "write",
  inputSchema: z.object({
    document_id: z.string().uuid(),
    investment_id: z.string().uuid(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const [docName, invName] = await Promise.all([
      resolveName(ctx, "document", input.document_id),
      resolveName(ctx, "investment", input.investment_id),
    ]);
    return { summary: `Link "${docName}" to ${invName}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    await verifyResourceOwnership(ctx, { resourceType: "investment", resourceId: input.investment_id });
    const result = await dispatchAction(ctx, "link_document_to_investment", {
      investment_id: input.investment_id,
      document_id: input.document_id,
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const unlinkDocumentTool = defineTool({
  name: "unlink_document",
  description:
    "Detach a document from its entity and/or investment without deleting the file. Used when a document was classified to the wrong entity/deal.",
  kind: "write",
  inputSchema: z.object({
    document_id: z.string().uuid(),
    scope: z.enum(["entity", "investment", "both"]),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    const docName = await resolveName(ctx, "document", input.document_id);
    return { summary: `Unlink "${docName}" (scope: ${input.scope})` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    const result = await dispatchAction(ctx, "unlink_document", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const archiveDocumentTool = defineTool({
  name: "archive_document",
  description: "Soft-remove a document from active views by setting deleted_at. Reversible.",
  kind: "write",
  inputSchema: z.object({ document_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    const docName = await resolveName(ctx, "document", input.document_id);
    return { summary: `Archive "${docName}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    const result = await dispatchAction(ctx, "archive_document", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- update_document ---------------------------------------------------------

export const updateDocumentTool = defineTool({
  name: "update_document",
  description:
    "Update a document's metadata — rename it, reclassify its type or category, or set its year or " +
    "jurisdiction. Use 'rename that document' or 'this is actually a K-1, not a tax return'. " +
    "Changing document_type may flip which entity expectation the document satisfies; satisfaction " +
    "is re-checked automatically after the write.",
  kind: "write",
  inputSchema: z.object({
    document_id: z.string().uuid(),
    name: z.string().min(1).optional().describe("New filename/display name."),
    document_type: z.string().optional().describe("Document type slug, e.g. 'k1', 'operating_agreement'."),
    document_category: z
      .enum(["formation", "tax", "investor", "contracts", "compliance", "insurance", "governance", "other"])
      .optional(),
    year: z.number().int().min(1900).max(2100).optional().nullable(),
    jurisdiction: z.string().optional().nullable().describe("2-letter state code if the document is state-scoped."),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    const docName = await resolveName(ctx, "document", input.document_id);
    const changed = Object.keys(input).filter((k) => k !== "document_id" && (input as Record<string, unknown>)[k] !== undefined);
    if (changed.length === 0) {
      return { summary: `No fields to update on "${docName}"` };
    }
    const { name, document_type, document_category, year, jurisdiction } = input;
    if (name && changed.length === 1) {
      return { summary: `Rename "${docName}" to "${name}"`, preview: input };
    }
    if (document_type && changed.length === 1) {
      return { summary: `Reclassify "${docName}" as ${humanizeDocType(document_type)}`, preview: input };
    }
    // Show actual values for the fields being touched, not just field names.
    // Previously we said "(also updating name, category, year)" — opaque to
    // the user who can't tell what name / category / year without expanding
    // the action. List the values inline instead.
    const valueParts: string[] = [];
    if (document_type) valueParts.push(humanizeDocType(document_type));
    if (document_category) valueParts.push(humanizeCategory(document_category));
    if (year !== undefined && year !== null) valueParts.push(`${year}`);
    if (jurisdiction !== undefined && jurisdiction !== null && typeof jurisdiction === "string") {
      valueParts.push(jurisdiction);
    }
    const renameSuffix = name ? ` and rename to "${name}"` : "";
    if (document_type) {
      const tail = valueParts.slice(1).join(" · ");
      const tailSuffix = tail ? ` · ${tail}` : "";
      return {
        summary: `Reclassify "${docName}" as ${humanizeDocType(document_type)}${tailSuffix}${renameSuffix}`,
        preview: input,
      };
    }
    const labelValuePairs: string[] = [];
    for (const k of changed) {
      const label = UPDATE_DOC_FIELD_LABEL[k] ?? k;
      const v = (input as Record<string, unknown>)[k];
      if (k === "year") labelValuePairs.push(`${label} ${v}`);
      else if (k === "document_category" && typeof v === "string") labelValuePairs.push(`${label} ${humanizeCategory(v)}`);
      else if (typeof v === "string" && v) labelValuePairs.push(`${label} "${v}"`);
      else labelValuePairs.push(label);
    }
    return {
      summary: `Update "${docName}" — ${labelValuePairs.join(" · ")}`,
      preview: input,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });
    const result = await dispatchAction(ctx, "update_document", input as Record<string, unknown>);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- Document expectations ---------------------------------------------------

export const addDocumentExpectationTool = defineTool({
  name: "add_document_expectation",
  description:
    "Add a manual document expectation to an entity. Use when an entity needs a specific document " +
    "not covered by the default profiles — e.g. a K-1, a specific agreement, or a document you " +
    "identified as missing from a filing. Check list_document_expectations first to avoid duplicates. " +
    "Manual expectations persist across engine refreshes.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    document_type: z
      .string()
      .min(1)
      .describe("Document type slug, e.g. 'k1', 'service_agreement'. Use snake_case."),
    document_category: z
      .enum(["formation", "tax", "investor", "contracts", "compliance", "insurance", "governance", "other"])
      .describe("Which document-list category this belongs to."),
    is_required: z.boolean().optional().default(true),
    notes: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    const docLabel = humanizeDocType(input.document_type);
    return {
      summary: `Add ${input.is_required ? "required" : "optional"} ${docLabel} to ${name}'s checklist`,
      preview: {
        entity: name,
        document_type: docLabel,
        category: humanizeCategory(input.document_category),
        required: input.is_required,
        notes: input.notes,
      },
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "add_document_expectation", {
      entity_id: input.entity_id,
      document_type: input.document_type,
      document_category: input.document_category,
      is_required: input.is_required,
      notes: input.notes,
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const dismissDocumentExpectationTool = defineTool({
  name: "dismiss_document_expectation",
  description:
    "Dismiss a document expectation — marks it not applicable for this entity. Use when the user says " +
    "they don't need a particular document, or to dismiss an AI-suggested document. The expectation " +
    "won't reappear on refresh. Get the expectation_id from list_document_expectations first. " +
    "Set is_suggestion=true if dismissing an AI suggestion so the inference engine won't re-suggest it.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    expectation_id: z.string().uuid(),
    is_suggestion: z
      .boolean()
      .optional()
      .default(false)
      .describe("True if this is an AI suggestion (is_suggestion=true). Uses the dismiss-suggestion path."),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    const { data: exp } = await ctx.supabase
      .from("entity_document_expectations")
      .select("document_type")
      .eq("id", input.expectation_id)
      .eq("entity_id", input.entity_id)
      .maybeSingle();
    const rawType = (exp as { document_type?: string } | null)?.document_type;
    const label = rawType ? humanizeDocType(rawType) : "this requirement";
    return {
      summary: input.is_suggestion
        ? `Dismiss suggestion "${label}" for ${name}`
        : `Mark "${label}" not applicable for ${name}`,
    };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const action = input.is_suggestion
      ? "dismiss_document_suggestion"
      : "dismiss_document_expectation";
    const result = await dispatchAction(ctx, action, {
      entity_id: input.entity_id,
      expectation_id: input.expectation_id,
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const acceptDocumentSuggestionTool = defineTool({
  name: "accept_document_suggestion",
  description:
    "Accept an AI-suggested document expectation — converts it from a suggestion into a real " +
    "requirement for this entity. Use when the user confirms a suggestion from the inference engine. " +
    "Get the expectation_id from list_document_expectations with status='suggested'.",
  kind: "write",
  inputSchema: z.object({
    entity_id: z.string().uuid(),
    expectation_id: z.string().uuid(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const name = await resolveName(ctx, "entity", input.entity_id);
    const { data: exp } = await ctx.supabase
      .from("entity_document_expectations")
      .select("document_type")
      .eq("id", input.expectation_id)
      .eq("entity_id", input.entity_id)
      .maybeSingle();
    const rawType = (exp as { document_type?: string } | null)?.document_type;
    const label = rawType ? humanizeDocType(rawType) : "this suggestion";
    return { summary: `Accept suggestion "${label}" as a requirement for ${name}` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "entity", resourceId: input.entity_id });
    const result = await dispatchAction(ctx, "accept_document_suggestion", {
      entity_id: input.entity_id,
      expectation_id: input.expectation_id,
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

// --- split_document --------------------------------------------------------

export const splitDocumentTool = defineTool({
  name: "split_document",
  description:
    "Split a multi-section PDF into separate documents. Use when a single PDF " +
    "contains multiple logical documents (e.g., distribution notices for " +
    "different investors, K-1 packages with multiple recipients, tax packages " +
    "bundling returns and schedules). The system detects section boundaries " +
    "(form-type changes, EIN changes, investor-name changes), creates child " +
    "documents for each section, and queues them for review. Requires the " +
    "document to be a PDF. The split runs in the background — the tool " +
    "returns a batch_id and the user picks up the results on the review page.",
  // Marked as a read tool so it executes immediately — no approval card.
  // Splitting is bookkeeping (creates child queue items + uploads per-section
  // PDFs to storage); the actual user-facing mutations come later when the
  // user approves each child document on the review page. Same shape as
  // unlock_document. Asking the user to approve "split this document" before
  // they can review the per-section results adds friction without adding
  // safety — the destructive surface is the children's actions, not the
  // split itself.
  kind: "read",
  inputSchema: z.object({
    document_id: z.string().uuid().describe(
      "The document to split. Must be a PDF.",
    ),
    hint: z.enum(["per_investor", "tax_package", "auto"]).optional().describe(
      "Optional split-style hint. 'per_investor' for distribution / capital-call " +
      "notices, 'tax_package' for bundled tax filings, 'auto' (default) lets the " +
      "system detect from content. Ignored when explicit `sections` are provided.",
    ),
    sections: z
      .array(
        z.object({
          page_range: z
            .tuple([z.number().int().min(1), z.number().int().min(1)])
            .describe(
              "Inclusive 1-indexed [start, end] page range for this section.",
            ),
          entity_id: z
            .string()
            .uuid()
            .optional()
            .describe(
              "If you've identified the recipient/investor entity for this section (e.g., from reading the page's partner name), pass its UUID. The child queue item will be pre-labeled, skipping re-identification during extraction.",
            ),
          type_hint: z
            .string()
            .optional()
            .describe(
              "Optional document_type slug for this section (e.g., 'distribution_notice', 'k1', 'tax_return_1065').",
            ),
        }),
      )
      .optional()
      .describe(
        "Explicit section breakdown. When provided, the structural scan is bypassed and each section becomes a child queue item with the given page_range and (optionally) pre-set entity_id. Use this when you've already verified the splitting (e.g., 'I checked active investors against page partner names and they're 1:1').",
      ),
  }),
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: input.document_id });

    // 1. Fetch the document row (and confirm it's a PDF in this org).
    //    document_type / document_category drive the per-page fallback
    //    below when the structural scan can't find any section breaks.
    //    investment_id is read so we can populate split_context with the
    //    parent's known investment + investor entity_ids — that's what
    //    keeps per-investor split children from losing the fund context
    //    that was on the parent's cover page.
    const { data: doc, error: docErr } = await ctx.supabase
      .from("documents")
      .select(
        "id, name, file_path, mime_type, entity_id, organization_id, document_type, document_category, investment_id",
      )
      .eq("id", input.document_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (docErr) throw docErr;
    if (!doc) throw new Error("Document not found");
    if (doc.mime_type !== "application/pdf") {
      throw new Error("Only PDFs can be split");
    }

    // 2. Pull the file bytes from storage so we can scan and split.
    const { data: fileData, error: dlErr } = await ctx.supabase.storage
      .from("documents")
      .download(doc.file_path);
    if (dlErr || !fileData) throw new Error("Could not download document");
    const buffer = Buffer.from(await (fileData as Blob).arrayBuffer());

    // 3. Create a batch so the children land somewhere reviewable. Tagged
    //    with source_document_id and split_hint so the /review page (and
    //    debug queries) can see this batch came from a split.
    const { data: batch, error: batchErr } = await ctx.supabase
      .from("document_batches")
      .insert({
        organization_id: ctx.orgId,
        status: "processing",
        name: `Split: ${doc.name}`,
        context: "chat",
        total_documents: 1,
        metadata: {
          source_document_id: doc.id,
          split_hint: input.hint ?? "auto",
        },
      })
      .select("id")
      .single();
    if (batchErr || !batch) throw new Error("Could not create split batch");

    // 4. Create a parent queue item. After children are queued the parent
    //    flips to auto_ingested — it's a container, not a unit of work.
    //    split_depth: 0 since the chat is splitting a top-level document.
    const { data: parentItem, error: parentErr } = await ctx.supabase
      .from("document_queue")
      .insert({
        batch_id: batch.id,
        status: "queued",
        original_filename: doc.name,
        file_path: doc.file_path,
        file_size: buffer.length,
        mime_type: "application/pdf",
        document_id: doc.id,
        is_composite: true,
        split_depth: 0,
      })
      .select()
      .single();
    if (parentErr || !parentItem) throw new Error("Could not create queue item");

    // 5. Determine sections. Three sources, in priority order:
    //    a) caller-supplied explicit sections (agent already verified them) —
    //       skip the heuristic scan entirely; this is the trusted path.
    //    b) structural scan finds section breaks → use those.
    //    c) per-page fallback when hint=per_investor and scan found nothing.
    //    Otherwise: no sections, hand off to AI splitting in the worker.
    const { analyzePdf } = await import("@/lib/pipeline/pdf-processor");
    const pdfAnalysis = await analyzePdf(buffer, null);

    type SplitterSection = {
      page_range: [number, number];
      type_hint?: string;
      entity_id?: string;
    };
    let sections: SplitterSection[] = [];
    let splitReason: "structural" | "per_investor_hint" | "model_composite" = "structural";

    if (input.sections && input.sections.length > 0) {
      // Caller (typically an agent run) verified the breakdown via tools
      // (matched investors against page partners, etc.) and is passing
      // explicit section info. Trust it. Each section may carry a
      // pre-identified entity_id which the splitter writes onto the child
      // queue item — skipping re-identification during extraction.
      sections = input.sections.map((s) => ({
        page_range: s.page_range as [number, number],
        type_hint: s.type_hint,
        entity_id: s.entity_id,
      }));
      splitReason = "per_investor_hint";
    } else {
      const { scanDocumentStructure } = await import("@/lib/pipeline/triage");
      const scan = await scanDocumentStructure(buffer);

      if (scan.section_breaks.length > 0) {
        const breaks = [
          1,
          ...scan.section_breaks.map((b) => b.page),
          pdfAnalysis.page_count + 1,
        ];
        for (let i = 0; i < breaks.length - 1; i++) {
          sections.push({
            page_range: [breaks[i], breaks[i + 1] - 1] as [number, number],
            type_hint: scan.distinct_form_types[i] || undefined,
          });
        }
      }

      // Per-page fallback when caller hinted per_investor and scan missed.
      if (
        sections.length === 0 &&
        pdfAnalysis.page_count >= 2 &&
        input.hint === "per_investor"
      ) {
        splitReason = "per_investor_hint";
        for (let p = 1; p <= pdfAnalysis.page_count; p++) {
          sections.push({
            page_range: [p, p],
            type_hint: doc.document_type || undefined,
          });
        }
      }
    }

    if (sections.length === 0) {
      // No structural breaks AND no per_investor hint. Hand the parent to
      // the worker; if extraction reports is_composite, the worker will run
      // the splitter from the model's sub_documents. Otherwise the parent
      // is just a single-doc that doesn't need splitting.
      const { processQueueItem } = await import("@/lib/pipeline/worker");
      processQueueItem(parentItem.id).catch((err) => {
        console.error(`[split_document] worker run failed for ${parentItem.id}:`, err);
      });
      return {
        data: {
          batch_id: batch.id,
          structural_sections: 0,
          page_count: pdfAnalysis.page_count,
          message:
            "No structural breaks detected — queued for AI-based splitting. Check the review page for results.",
        },
      };
    }

    // 6. Resolve known_investment_id + known_entity_ids for split_context.
    //    If the parent doc is already linked to an investment, surface that
    //    + the investment's investor entity_ids so per-investor children
    //    can match against a tight 3-name list rather than the full org.
    const knownInvestmentId: string | null = doc.investment_id ?? null;
    let knownEntityIds: string[] = [];
    if (knownInvestmentId) {
      const { data: investorRows } = await ctx.supabase
        .from("investment_investors")
        .select("entity_id")
        .eq("investment_id", knownInvestmentId)
        .eq("is_active", true);
      knownEntityIds = (investorRows || [])
        .map((r) => r.entity_id as string | null)
        .filter((id): id is string => !!id);
    }

    // 7. Hand off to the splitter. Children land in status:queued with
    //    split_context populated; the worker picks them up exactly like
    //    fresh uploads. No extraction here — that's the worker's job.
    const { splitDocumentIntoChildren } = await import("@/lib/pipeline/splitter");
    const { updateBatchStats } = await import("@/lib/pipeline/worker");

    splitDocumentIntoChildren(ctx.supabase, {
      parentItem: {
        id: parentItem.id,
        batch_id: batch.id,
        original_filename: doc.name,
        split_depth: 0,
      },
      parentBuffer: buffer,
      sections,
      splitReason,
      orgId: ctx.orgId,
      userContext: null, // chat doesn't currently thread its own context here
      knownInvestmentId,
      knownEntityIds,
    })
      .then(async (result) => {
        if (result.skipped === "max_depth") {
          // Can't happen at split_depth=0 but handle defensively.
          await ctx.supabase
            .from("document_queue")
            .update({
              status: "error",
              extraction_error: "Split refused: depth cap exceeded",
              updated_at: new Date().toISOString(),
            })
            .eq("id", parentItem.id);
        } else {
          await ctx.supabase
            .from("document_queue")
            .update({
              status: "auto_ingested",
              updated_at: new Date().toISOString(),
            })
            .eq("id", parentItem.id);
        }
        await updateBatchStats(ctx.supabase, batch.id);
      })
      .catch(async (err) => {
        console.error(`[split_document] split failed for batch ${batch.id}:`, err);
        await ctx.supabase
          .from("document_queue")
          .update({
            status: "error",
            extraction_error: err instanceof Error ? err.message : "Split failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", parentItem.id);
        await updateBatchStats(ctx.supabase, batch.id);
      });

    return {
      data: {
        batch_id: batch.id,
        structural_sections: sections.length,
        page_count: pdfAnalysis.page_count,
        message: `Splitting "${doc.name}" into ${sections.length} sections. Check the review page once they finish processing.`,
      },
    };
  },
});

export const documentWriteTools: ToolDefinition[] = [
  linkDocumentToEntityTool,
  linkDocumentToInvestmentTool,
  unlinkDocumentTool,
  archiveDocumentTool,
  updateDocumentTool,
  addDocumentExpectationTool,
  dismissDocumentExpectationTool,
  acceptDocumentSuggestionTool,
  splitDocumentTool,
];
