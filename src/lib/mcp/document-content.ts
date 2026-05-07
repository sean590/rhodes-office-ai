/**
 * Build Anthropic-compatible content blocks for file attachments in a chat turn.
 *
 * This is the `contentBlocksForTurn` function from the master architecture
 * spec's "Unified document flow" section. It takes attachment metadata from
 * the chat request, fetches each file from Supabase Storage, runs lightweight
 * analysis (PDF tier classification + text extraction + visual rendering),
 * and returns content blocks that the orchestrator appends to the user
 * message before sending to Claude.
 *
 * No deep extraction (entity matching, compliance detection) happens here —
 * that's the pipeline worker's job, running in the background.
 *
 * Reuses the existing `pdf-processor.ts` infrastructure directly:
 * - `analyzePdf(buffer, stagedDocType)` for tier classification
 * - `buildPdfContent(buffer, analysis, docName, docType, year)` for content blocks
 * - `extractFullText(buffer)` for text extraction
 *
 * The content blocks are native Anthropic format (type: "text", type: "image",
 * type: "document") — no transformation needed downstream.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  analyzePdf,
  buildPdfContent,
} from "@/lib/pipeline/pdf-processor";

export interface ChatAttachment {
  storage_path: string;
  filename: string;
  content_type: string;
  size: number;
  document_id?: string;
  batch_id?: string;
}

const MAX_TEXT_FILE_CHARS = 480_000;

/**
 * Build content blocks for all attachments in a single chat turn.
 * Non-fatal per-attachment: if one file fails, the rest still process.
 * A text block noting the failure is included so Claude knows the file
 * was uploaded but couldn't be read.
 */
export async function contentBlocksForTurn(
  attachments: ChatAttachment[],
): Promise<Array<Record<string, unknown>>> {
  const admin = createAdminClient();
  const blocks: Array<Record<string, unknown>> = [];

  for (const att of attachments) {
    try {
      const fileBlocks = await buildContentForAttachment(admin, att);
      blocks.push(...fileBlocks);
    } catch (err) {
      console.error(`[document-content] failed to process ${att.filename}:`, err);
      blocks.push({
        type: "text",
        text: `[Document "${att.filename}" could not be processed: ${(err as Error).message}. The file was uploaded to storage and will be processed by the pipeline in the background.]`,
      });
    }
  }

  return blocks;
}

async function buildContentForAttachment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  att: ChatAttachment,
): Promise<Array<Record<string, unknown>>> {
  // Fetch the file from Supabase Storage.
  const { data: fileData, error: downloadError } = await admin.storage
    .from("documents")
    .download(att.storage_path);
  if (downloadError || !fileData) {
    throw new Error(`storage download failed: ${downloadError?.message ?? "no data"}`);
  }

  const buffer = Buffer.from(await (fileData as Blob).arrayBuffer());

  // --- Images → single base64 image block ---
  if (att.content_type.startsWith("image/")) {
    const base64 = buffer.toString("base64");
    const mediaType = att.content_type as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";
    return [
      {
        type: "text",
        text: `[Uploaded image: ${att.filename}${att.document_id ? ` (document_id: ${att.document_id})` : ""}]`,
      },
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      },
    ];
  }

  // --- PDFs → analyzePdf + buildPdfContent (reuses existing infra) ---
  if (
    att.content_type === "application/pdf" ||
    att.filename.toLowerCase().endsWith(".pdf")
  ) {
    const analysis = await analyzePdf(buffer, null);
    const pdfBlocks = await buildPdfContent(
      buffer,
      analysis,
      att.filename,
      null,
      null,
    );
    return [
      {
        type: "text",
        text: `[Uploaded PDF: ${att.filename}${att.document_id ? ` (document_id: ${att.document_id})` : ""} — ${analysis.page_count} pages, tier: ${analysis.tier}]`,
      },
      ...(pdfBlocks as Array<Record<string, unknown>>),
    ];
  }

  // --- Text files (.txt, .md, .csv, text/*) → inline text block ---
  if (
    att.content_type.startsWith("text/") ||
    /\.(txt|md|csv|tsv|json)$/i.test(att.filename)
  ) {
    let text = buffer.toString("utf-8");
    let truncated = false;
    if (text.length > MAX_TEXT_FILE_CHARS) {
      text = text.slice(0, MAX_TEXT_FILE_CHARS);
      truncated = true;
    }
    return [
      {
        type: "text",
        text: `[Uploaded file: ${att.filename}${att.document_id ? ` (document_id: ${att.document_id})` : ""}${truncated ? " (truncated to 480k chars)" : ""}]\n\n${text}`,
      },
    ];
  }

  // --- Unknown content type → reference only ---
  return [
    {
      type: "text",
      text: `[Uploaded file: ${att.filename}${att.document_id ? ` (document_id: ${att.document_id})` : ""} (${att.content_type}, ${att.size} bytes). This file type cannot be displayed inline. It has been uploaded to storage and will be processed by the pipeline.]`,
    },
  ];
}
