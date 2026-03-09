/**
 * PDF processing utilities for the document pipeline.
 * Handles page counting, text extraction, page splitting, and content building
 * for the Claude API across three tiers of PDF complexity.
 */

import "./pdf-polyfill"; // Must be before pdf-parse to stub DOMMatrix/Path2D/ImageData
import { PDFDocument } from "pdf-lib";
import { PDFParse } from "pdf-parse";
import { createRequire } from "module";

// Point pdfjs-dist worker to the correct absolute path so the dynamic
// import() in fake-worker mode doesn't fail on Vercel with pnpm
try {
  const require = createRequire(import.meta.url);
  const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  PDFParse.setWorker(workerPath);
} catch {
  // Fallback: let pdfjs use its default relative resolution
}

// --- Page Selection Strategies ---

export interface PageSelectionStrategy {
  visual_pages: "first_n" | "specific_ranges" | "none";
  visual_page_ranges?: Array<[number, number]>; // [start, end] inclusive, 1-indexed
  visual_first_n?: number;
  include_full_text: boolean;
  extraction_hint: string;
}

const PAGE_STRATEGIES: Record<string, PageSelectionStrategy> = {
  // Tax Returns
  tax_return_1065: {
    visual_pages: "specific_ranges",
    visual_page_ranges: [[1, 6]],
    include_full_text: true,
    extraction_hint:
      "This is a partnership tax return (Form 1065). Key data is on pages 1-5 (income, deductions, balance sheet). K-1 schedules may appear later in the document — the full text is provided. Extract: entity name, EIN, tax year, ordinary business income, guaranteed payments, partner K-1 allocations, and any state-specific information. This may be a composite tax package — check for state returns and K-1s.",
  },
  tax_return_1120s: {
    visual_pages: "specific_ranges",
    visual_page_ranges: [[1, 6]],
    include_full_text: true,
    extraction_hint:
      "This is an S-Corp tax return (Form 1120-S). Key data on pages 1-5. Shareholder K-1s may be later. Extract: entity name, EIN, tax year, ordinary income, shareholder distributions, officer compensation. Check for state returns and K-1s.",
  },
  tax_return_1041: {
    visual_pages: "specific_ranges",
    visual_page_ranges: [[1, 4]],
    include_full_text: true,
    extraction_hint:
      "This is a fiduciary/trust tax return (Form 1041). Key data on pages 1-3. Beneficiary K-1s later. Extract: trust name, EIN, tax year, income, deductions, distributions to beneficiaries. Check for state returns and K-1s.",
  },
  tax_return_1040: {
    visual_pages: "specific_ranges",
    visual_page_ranges: [[1, 4]],
    include_full_text: true,
    extraction_hint:
      "This is a personal tax return (Form 1040). Key data on pages 1-2. Schedule E (rental/partnership income) and other schedules follow. Extract: taxpayer name, SSN (last 4 only), tax year, AGI, K-1 income reported, state returns if present.",
  },
  k1: {
    visual_pages: "first_n",
    visual_first_n: 50,
    include_full_text: true,
    extraction_hint:
      "This appears to be a K-1 or K-1 package. Each K-1 is typically 1-3 pages. Extract ALL K-1s found: partner/shareholder name, entity name, EIN, tax year, ordinary income, capital gains, guaranteed payments, distributions, and any state-specific K-1 amounts.",
  },
  tax_package: {
    visual_pages: "first_n",
    visual_first_n: 50,
    include_full_text: true,
    extraction_hint:
      "This is a tax package — a composite PDF containing multiple tax documents bundled together. Identify ALL logical documents within: federal returns, state returns, K-1s, filing instructions, extensions, e-file authorizations. Return them as sub_documents.",
  },

  // Formation Documents
  operating_agreement: {
    visual_pages: "first_n",
    visual_first_n: 30,
    include_full_text: true,
    extraction_hint:
      "This is an operating agreement. Key provisions (members, managers, ownership, distributions, governance) are typically in the first 30 pages. Exhibits and schedules may follow. Extract: entity name, formation state, members, managers, ownership percentages, business purpose, tax classification.",
  },
  trust_agreement: {
    visual_pages: "first_n",
    visual_first_n: 30,
    include_full_text: true,
    extraction_hint:
      "This is a trust agreement. Key provisions are in the first 20-30 pages. Extract: trust name, trust type (revocable/irrevocable), trust date, grantor, trustees, successor trustees, beneficiaries, situs state, purpose.",
  },

  // Default
  _default: {
    visual_pages: "first_n",
    visual_first_n: 20,
    include_full_text: true,
    extraction_hint:
      "This is a long document. The first 20 pages are provided visually. The full text of all pages follows. Identify the document type and extract all relevant entity information.",
  },
};

// --- Core Functions ---

export interface PDFAnalysis {
  page_count: number;
  file_size: number;
  tier: "short" | "medium" | "long";
  strategy: PageSelectionStrategy;
}

/**
 * Analyze a PDF and determine the extraction strategy.
 */
export async function analyzePdf(
  buffer: Buffer,
  stagedDocType: string | null
): Promise<PDFAnalysis> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();

  let tier: "short" | "medium" | "long";
  if (pageCount <= 50) tier = "short";
  else if (pageCount <= 100) tier = "medium";
  else tier = "long";

  const strategy =
    PAGE_STRATEGIES[stagedDocType || ""] || PAGE_STRATEGIES["_default"];

  return { page_count: pageCount, file_size: buffer.length, tier, strategy };
}

/**
 * Extract raw text from all pages of a PDF.
 */
export async function extractFullText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Split a PDF to only include specific page ranges.
 * Returns a new PDF buffer containing only the selected pages.
 */
export async function extractPageRange(
  buffer: Buffer,
  ranges: Array<[number, number]> // 1-indexed inclusive
): Promise<Buffer> {
  const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const newPdf = await PDFDocument.create();

  for (const [start, end] of ranges) {
    const startIdx = Math.max(0, start - 1);
    const endIdx = Math.min(sourcePdf.getPageCount() - 1, end - 1);
    if (startIdx > endIdx) continue;

    const pages = await newPdf.copyPages(
      sourcePdf,
      Array.from({ length: endIdx - startIdx + 1 }, (_, i) => startIdx + i)
    );
    pages.forEach((page) => newPdf.addPage(page));
  }

  const bytes = await newPdf.save();
  return Buffer.from(bytes);
}

/**
 * Build the Claude API content array for a PDF based on its analysis.
 */
export async function buildPdfContent(
  buffer: Buffer,
  analysis: PDFAnalysis,
  docName: string,
  docType: string | null,
  year: number | null
): Promise<unknown[]> {
  const content: unknown[] = [];

  if (analysis.tier === "short") {
    // Tier 1: send whole PDF as-is
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: buffer.toString("base64"),
      },
    });
  } else {
    // Tier 2 & 3: text + selective visual pages
    const strategy = analysis.strategy;

    // Extract and send full text
    if (strategy.include_full_text) {
      const fullText = await extractFullText(buffer);
      content.push({
        type: "text",
        text: `## Full Document Text (${analysis.page_count} pages)\n\n${fullText}`,
      });
    }

    // Send visual pages (as a split PDF)
    if (strategy.visual_pages !== "none") {
      let visualBuffer: Buffer;

      if (strategy.visual_pages === "first_n") {
        const n = Math.min(
          strategy.visual_first_n || 20,
          analysis.page_count
        );
        visualBuffer = await extractPageRange(buffer, [[1, n]]);
      } else {
        // specific_ranges
        const ranges = strategy.visual_page_ranges || [[1, 20]];
        const clampedRanges = ranges.map(
          ([s, e]) =>
            [
              Math.min(s, analysis.page_count),
              Math.min(e, analysis.page_count),
            ] as [number, number]
        );
        visualBuffer = await extractPageRange(buffer, clampedRanges);
      }

      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: visualBuffer.toString("base64"),
        },
      });

      const visualDesc =
        strategy.visual_pages === "first_n"
          ? `pages 1-${strategy.visual_first_n}`
          : `pages ${strategy.visual_page_ranges?.map(([s, e]) => `${s}-${e}`).join(", ")}`;
      content.push({
        type: "text",
        text: `Note: The PDF above shows ${visualDesc} of the full ${analysis.page_count}-page document. The complete text was provided above.`,
      });
    }
  }

  // Final instruction
  const typeDesc = docType ? docType.replace(/_/g, " ") : "unknown type";
  let instruction = `Analyze this ${typeDesc} document and propose database changes. The document is named "${docName}"${year ? ` and is from year ${year}` : ""}.`;

  if (analysis.strategy.extraction_hint) {
    instruction += `\n\n${analysis.strategy.extraction_hint}`;
  }

  if (analysis.tier !== "short") {
    instruction += `\n\nThis is a ${analysis.page_count}-page document. You have the full text plus visual rendering of key pages. Focus on extracting structured data — don't try to summarize every page.`;
  }

  content.push({ type: "text", text: instruction });

  return content;
}
