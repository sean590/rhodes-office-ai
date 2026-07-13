/**
 * Document navigation tools — additive fallback for large or truncated docs.
 *
 * Since buildPdfContent already sends full text + visual pages even for large
 * docs, Claude can read most documents without these tools. They're useful as
 * a fallback for targeted extraction from specific page ranges, and become
 * essential later when document splitting ships.
 *
 * get_document_outline — page count, detected sections, extraction metadata
 * get_document_section — text for specific page ranges
 * search_document_text — keyword search within a document's text
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { verifyResourceOwnership } from "../ownership";
import { extractFullText, extractPageRange } from "@/lib/pipeline/pdf-processor";

const MAX_SECTION_TOKENS = 30_000;
const MAX_SECTION_CHARS = MAX_SECTION_TOKENS * 4;

// --- get_document_outline ----------------------------------------------------

export const getDocumentOutlineTool = defineTool({
  name: "get_document_outline",
  description:
    "Returns a document's metadata: page count, content type, filename, and extraction results from the pipeline (if available). Use when you need to understand a document's structure before fetching specific sections.",
  kind: "read",
  inputSchema: z.object({ document_id: z.string().uuid() }),
  handler: async ({ document_id }, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: document_id });
    const { data, error } = await ctx.supabase
      .from("documents")
      .select("id, name, document_type, document_category, year, file_path, mime_type, file_size, ai_extracted, ai_extraction, created_at")
      .eq("id", document_id)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .single();
    if (error) throw error;
    if (!data) return { data: null };

    const extraction = (data.ai_extraction ?? {}) as Record<string, unknown>;
    return {
      data: ctx.redact({
        id: data.id,
        name: data.name,
        document_type: data.document_type,
        document_category: data.document_category,
        year: data.year,
        content_type: data.mime_type,
        file_size: data.file_size,
        ai_extracted: data.ai_extracted,
        page_count: extraction.page_count ?? null,
        tier: extraction.tier ?? null,
        sections: extraction.sections ?? null,
        toc: extraction.toc ?? null,
        detected_forms: extraction.detected_forms ?? null,
        pipeline_status: data.ai_extracted ? "complete" : "in_progress",
      }),
    };
  },
});

// --- get_document_section ----------------------------------------------------

const getDocumentSectionInput = z.object({
  document_id: z.string().uuid(),
  section_ref: z
    .string()
    .describe("Page range string like 'pages:1-5' or 'pages:33-38'. 1-indexed, inclusive."),
});

export const getDocumentSectionTool: ToolDefinition = {
  name: "get_document_section",
  description:
    "Fetch extracted text for a specific page range of a PDF. Returns text content for the requested pages, token-capped at 30k. Use after get_document_outline to target specific sections.",
  kind: "read",
  inputSchema: getDocumentSectionInput,
  handler: async (rawArgs, ctx) => {
    const { document_id, section_ref } = getDocumentSectionInput.parse(rawArgs);
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: document_id });

    // Parse section_ref like "pages:1-5".
    const pageMatch = section_ref.match(/^pages?:(\d+)-(\d+)$/i);
    if (!pageMatch) {
      return {
        data: { error: "Invalid section_ref format. Use 'pages:1-5' (1-indexed, inclusive)." },
      };
    }
    const startPage = parseInt(pageMatch[1], 10);
    const endPage = parseInt(pageMatch[2], 10);
    if (startPage < 1 || endPage < startPage || endPage - startPage > 50) {
      return {
        data: { error: "Page range must be 1-indexed, start <= end, and span at most 50 pages." },
      };
    }

    // Fetch the PDF from Storage.
    const { data: doc } = await ctx.supabase
      .from("documents")
      .select("file_path")
      .eq("id", document_id)
      .eq("organization_id", ctx.orgId)
      .single();
    if (!doc?.file_path) return { data: { error: "Document file not found" } };

    const { data: fileData, error: dlErr } = await ctx.supabase.storage
      .from("documents")
      .download(doc.file_path);
    if (dlErr || !fileData) return { data: { error: `Download failed: ${dlErr?.message}` } };

    const buffer = Buffer.from(await (fileData as Blob).arrayBuffer());
    const pageBuffer = await extractPageRange(buffer, [[startPage, endPage]]);
    const text = await extractFullText(pageBuffer);

    let truncated = false;
    let resultText = text;
    if (resultText.length > MAX_SECTION_CHARS) {
      resultText = resultText.slice(0, MAX_SECTION_CHARS);
      truncated = true;
    }

    return {
      data: {
        document_id,
        section_ref,
        pages: `${startPage}-${endPage}`,
        text: resultText,
        truncated,
      },
    };
  },
};

// --- search_document_text ----------------------------------------------------

const searchDocumentTextInput = z.object({
  document_id: z.string().uuid(),
  query: z.string().min(1),
  max_results: z.number().int().min(1).max(20).optional().default(5),
});

export const searchDocumentTextTool: ToolDefinition = {
  name: "search_document_text",
  description:
    "Keyword search within a document's extracted text. Returns matching snippets with surrounding context. Uses the pipeline's full_text if available, otherwise extracts text on-demand from Storage.",
  kind: "read",
  inputSchema: searchDocumentTextInput,
  handler: async (rawArgs, ctx) => {
    const { document_id, query, max_results } = searchDocumentTextInput.parse(rawArgs);
    await verifyResourceOwnership(ctx, { resourceType: "document", resourceId: document_id });

    // Try to get full text from the pipeline's extraction results first.
    const { data: doc } = await ctx.supabase
      .from("documents")
      .select("file_path, ai_extraction")
      .eq("id", document_id)
      .eq("organization_id", ctx.orgId)
      .single();
    if (!doc) {
      return { data: { document_id, query, results: [] as Array<{ match_index: number; snippet: string }>, total_text_length: 0 } };
    }

    let fullText = "";
    const extraction = (doc.ai_extraction ?? {}) as Record<string, unknown>;
    if (typeof extraction.full_text === "string" && extraction.full_text.length > 0) {
      fullText = extraction.full_text;
    } else if (doc.file_path) {
      const { data: fileData } = await ctx.supabase.storage
        .from("documents")
        .download(doc.file_path);
      if (fileData) {
        const buffer = Buffer.from(await (fileData as Blob).arrayBuffer());
        fullText = await extractFullText(buffer);
      }
    }

    if (!fullText) {
      return { data: { document_id, query, results: [] as Array<{ match_index: number; snippet: string }>, total_text_length: 0 } };
    }

    // Simple case-insensitive keyword search with context window.
    const lowerText = fullText.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const results: Array<{ match_index: number; snippet: string }> = [];
    let pos = 0;
    const CONTEXT_CHARS = 300;

    while (results.length < (max_results ?? 5)) {
      const idx = lowerText.indexOf(lowerQuery, pos);
      if (idx === -1) break;
      const start = Math.max(0, idx - CONTEXT_CHARS);
      const end = Math.min(fullText.length, idx + lowerQuery.length + CONTEXT_CHARS);
      results.push({
        match_index: idx,
        snippet: (start > 0 ? "…" : "") + fullText.slice(start, end) + (end < fullText.length ? "…" : ""),
      });
      pos = idx + lowerQuery.length;
    }

    return {
      data: {
        document_id,
        query,
        results,
        total_text_length: fullText.length,
      },
    };
  },
};

// --- list_queue_items --------------------------------------------------------

const QUEUE_STATUSES = [
  "staged", "queued", "extracting", "extracted", "review_ready",
  "auto_ingested", "approved", "rejected", "error", "password_required",
] as const;

const listQueueItemsInput = z.object({
  status: z.enum(QUEUE_STATUSES).optional(),
  batch_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export const listQueueItemsTool: ToolDefinition = {
  name: "list_queue_items",
  description:
    "List items in the document processing queue. Use this to check on recently uploaded documents that may still be processing or waiting for review. Returns queue items with their status, filename, matched entity, and extraction results.",
  kind: "read",
  inputSchema: listQueueItemsInput,
  handler: async (rawArgs, ctx) => {
    const { status, batch_id, limit } = listQueueItemsInput.parse(rawArgs);
    const queryLimit = limit ?? 20;

    // document_queue doesn't carry organization_id — scope through the
    // batch's org. If a specific batch_id is given, verify it belongs to
    // this org. Otherwise, find all batch ids for this org first.
    let batchIds: string[];
    if (batch_id) {
      const { data: batch, error } = await ctx.supabase
        .from("document_batches")
        .select("id")
        .eq("id", batch_id)
        .eq("organization_id", ctx.orgId)
        .maybeSingle();
      if (error) throw error;
      if (!batch) return { data: [] };
      batchIds = [batch_id];
    } else {
      const { data: batches, error } = await ctx.supabase
        .from("document_batches")
        .select("id")
        .eq("organization_id", ctx.orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      batchIds = (batches ?? []).map((b: { id: string }) => b.id);
      if (batchIds.length === 0) return { data: [] };
    }

    let query = ctx.supabase
      .from("document_queue")
      .select(
        "id, original_filename, status, staged_entity_name, staged_entity_id, " +
        "ai_document_type, ai_entity_id, document_id, extraction_error, batch_id, created_at",
      )
      .in("batch_id", batchIds)
      .order("created_at", { ascending: false })
      .limit(queryLimit + 1);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown[];
    const truncated = rows.length > queryLimit;
    return {
      data: ctx.redact(truncated ? rows.slice(0, queryLimit) : rows),
      truncated,
    };
  },
};

// --- unlock_document ---------------------------------------------------------

const unlockDocumentInput = z.object({
  queue_item_id: z.string().uuid(),
  password: z.string().min(1),
});

export const unlockDocumentTool: ToolDefinition = {
  name: "unlock_document",
  description:
    "Provide a password to unlock a password-protected PDF that paused at the password_required step. Use after the user shares a password in chat. The password is used transiently for decryption — never stored. If the password is wrong, the tool returns an error and the document stays in password_required so you can ask the user again.",
  // Marked as a read tool so it executes immediately (no approval card).
  // The "write" surface is the queue item status change, which is bookkeeping
  // rather than a user-visible mutation in the data graph.
  kind: "read",
  inputSchema: unlockDocumentInput,
  handler: async (rawArgs, ctx) => {
    const { queue_item_id, password } = unlockDocumentInput.parse(rawArgs);

    // Cross-tenant guard via the same explicit two-query pattern used by
    // /api/pipeline/queue/[itemId]/unlock and the other queue-item routes:
    // fetch the item by id, then verify the batch belongs to this org via
    // an `.eq("organization_id", ctx.orgId)` filter at the DB layer (rather
    // than a JS comparison after the fact). Throw "Queue item not found"
    // for both genuinely-missing and cross-tenant — never leak existence.
    const { data: item, error: itemErr } = await ctx.supabase
      .from("document_queue")
      .select("id, status, batch_id, original_filename")
      .eq("id", queue_item_id)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) throw new Error("Queue item not found");

    const { data: batchOwn } = await ctx.supabase
      .from("document_batches")
      .select("id")
      .eq("id", item.batch_id)
      .eq("organization_id", ctx.orgId)
      .maybeSingle();
    if (!batchOwn) throw new Error("Queue item not found");

    if (item.status !== "password_required") {
      throw new Error(`Document is in status ${item.status}; nothing to unlock`);
    }

    // Re-run extraction with the password. processQueueItem catches
    // PdfPasswordRequiredError internally and parks the item back in
    // password_required, so a wrong password leaves state consistent — we
    // just detect that and tell Claude.
    const { processQueueItem } = await import("@/lib/pipeline/worker");
    await processQueueItem(queue_item_id, { password });

    const { data: refreshed } = await ctx.supabase
      .from("document_queue")
      .select("status, original_filename, extraction_error")
      .eq("id", queue_item_id)
      .maybeSingle();
    if (!refreshed) throw new Error("Lost track of queue item after unlock");

    if (refreshed.status === "password_required") {
      return {
        data: {
          ok: false,
          filename: refreshed.original_filename,
          message: "Incorrect password — please ask the user for a different password.",
        },
      };
    }
    if (refreshed.status === "error") {
      // Password worked but the post-decryption extraction tripped on
      // something else (corrupt PDF, AI extraction failure, etc.). Don't
      // claim success — relay the underlying error so Claude can explain.
      return {
        data: {
          ok: false,
          filename: refreshed.original_filename,
          message:
            refreshed.extraction_error ||
            "The password worked, but the document failed to process afterwards.",
        },
      };
    }
    return {
      data: {
        ok: true,
        filename: refreshed.original_filename,
        status: refreshed.status,
        message: `Unlocked. The document is now in status: ${refreshed.status}.`,
      },
    };
  },
};

// --- list_batches ------------------------------------------------------------

const BATCH_STATUSES = ["staging", "processing", "review", "completed"] as const;

const listBatchesInput = z.object({
  status: z.enum(BATCH_STATUSES).optional(),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export const listBatchesTool: ToolDefinition = {
  name: "list_batches",
  description:
    "List recent document batches for the organization. Returns batch-level summaries (name, status, document count, source, timestamps). Use to answer questions like 'what uploads have come in recently?' or 'is anything still processing?'. For per-document detail within a batch, use list_queue_items with the batch_id.",
  kind: "read",
  inputSchema: listBatchesInput,
  handler: async (rawArgs, ctx) => {
    const { status, limit } = listBatchesInput.parse(rawArgs);
    const queryLimit = limit ?? 10;

    let query = ctx.supabase
      .from("document_batches")
      .select("id, name, source_type, status, context, total_documents, metadata, created_at")
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(queryLimit + 1);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as unknown[];
    const truncated = rows.length > queryLimit;
    return {
      data: ctx.redact(truncated ? rows.slice(0, queryLimit) : rows),
      truncated,
    };
  },
};

export const documentNavTools: ToolDefinition[] = [
  getDocumentOutlineTool,
  getDocumentSectionTool,
  searchDocumentTextTool,
  listQueueItemsTool,
  listBatchesTool,
  unlockDocumentTool,
];
