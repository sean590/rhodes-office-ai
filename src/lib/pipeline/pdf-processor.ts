/**
 * PDF processing utilities for the document pipeline.
 * Handles page counting, text extraction, page splitting, and content building
 * for the Claude API across three tiers of PDF complexity.
 */

import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Thrown when a PDF requires a password to decrypt. Caught by the pipeline
 * worker and translated into queue status "password_required" so the user
 * can supply the password via chat or the inline UI.
 *
 * The password itself is NEVER stored — it's used transiently inside
 * extractFullText to decrypt the buffer for text extraction; the extracted
 * text is what gets persisted.
 */
export class PdfPasswordRequiredError extends Error {
  constructor(public readonly filename: string = "unknown") {
    super(`Password required for "${filename}"`);
    this.name = "PdfPasswordRequiredError";
  }
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

  // Investment / equity financing agreements
  series_seed_agreement: {
    visual_pages: "first_n",
    visual_first_n: 30,
    include_full_text: true,
    extraction_hint:
      "This is an equity financing agreement (Series Seed, Series A, SAFE, convertible note, or similar). Key terms — company name, investor list, share class, price per share, valuation, closing date, ownership percentages, board composition — are typically in the first 20-30 pages. Signature pages, exhibits, schedules, and stock certificates follow. Extract: company (investment target) name, investment round name, closing date, investors and their investment amounts, share counts, post-money valuation, and any pro-rata or anti-dilution terms. The user's entity (the investor) should be identifiable from the investor schedule. This is an EXTERNAL INVESTMENT — use create_investment, not create_entity.",
  },
  investment_agreement: {
    visual_pages: "first_n",
    visual_first_n: 30,
    include_full_text: true,
    extraction_hint:
      "This is an investment agreement. Key terms are typically in the first 20-30 pages; exhibits and schedules follow. Extract: counterparty/target name, investment amount, closing date, share class or instrument type, and any material terms (liquidation preference, pro-rata, board rights). This is an EXTERNAL INVESTMENT — use create_investment, not create_entity.",
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
 *
 * Tier thresholds are governed by the Anthropic context window (200k tokens),
 * NOT Claude's nominal 100-page PDF file limit. Each rendered PDF page costs
 * roughly 1700 input tokens, so a 96-page PDF alone would consume ~163k
 * tokens before any system prompt — well past the 200k window once you add
 * the org context (~30-50k) and extraction schema (~5k). The "short" tier
 * sends the whole PDF as a single base64 document and is only safe for ~20
 * pages of full-resolution rendering. Anything larger takes the text +
 * selective-visual path.
 */
export async function analyzePdf(
  buffer: Buffer,
  stagedDocType: string | null
): Promise<PDFAnalysis> {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();

  let tier: "short" | "medium" | "long";
  if (pageCount <= 20) tier = "short";
  else if (pageCount <= 100) tier = "medium";
  else tier = "long";

  // Clone the strategy so we can clamp visual page counts without mutating
  // the shared PAGE_STRATEGIES map.
  const baseStrategy =
    PAGE_STRATEGIES[stagedDocType || ""] || PAGE_STRATEGIES["_default"];
  const strategy: PageSelectionStrategy = { ...baseStrategy };

  // Defense in depth: no matter what the strategy says, never send more
  // visual pages than fit in a realistic token budget. Claude renders each
  // PDF page as ~1700 input tokens. Reserve ~80k for visual content
  // (~47 pages), leaving headroom for system prompt + schema + extracted
  // text + output budget inside the 200k window.
  const TOKENS_PER_PDF_PAGE = 1700;
  const VISUAL_TOKEN_BUDGET = 80_000;
  const maxVisualPages = Math.floor(VISUAL_TOKEN_BUDGET / TOKENS_PER_PDF_PAGE);

  if (strategy.visual_pages === "first_n" && strategy.visual_first_n) {
    strategy.visual_first_n = Math.min(strategy.visual_first_n, maxVisualPages);
  } else if (strategy.visual_pages === "specific_ranges" && strategy.visual_page_ranges) {
    let budgetRemaining = maxVisualPages;
    const clampedRanges: Array<[number, number]> = [];
    for (const [start, end] of strategy.visual_page_ranges) {
      if (budgetRemaining <= 0) break;
      const rangeLength = end - start + 1;
      if (rangeLength <= budgetRemaining) {
        clampedRanges.push([start, end]);
        budgetRemaining -= rangeLength;
      } else {
        clampedRanges.push([start, start + budgetRemaining - 1]);
        budgetRemaining = 0;
      }
    }
    strategy.visual_page_ranges = clampedRanges;
  }

  return { page_count: pageCount, file_size: buffer.length, tier, strategy };
}

/**
 * Extract raw text from all pages of a PDF.
 * Uses unpdf which bundles its own PDF.js — no worker file needed,
 * works reliably on Vercel serverless with pnpm.
 *
 * Password-protected PDFs throw a PdfPasswordRequiredError so the worker
 * can mark the queue item and resume the rest of the batch. Other extraction
 * failures still return "" (callers fall back to visual-only).
 */
export async function extractFullText(
  buffer: Buffer,
  options?: { password?: string },
): Promise<string> {
  try {
    if (options?.password) {
      const proxy = await getDocumentProxy(new Uint8Array(buffer), {
        password: options.password,
      });
      const result = await extractText(proxy, { mergePages: true });
      return typeof result.text === "string" ? result.text : (result.text as string[]).join("\n");
    }
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    return typeof result.text === "string" ? result.text : (result.text as string[]).join("\n");
  } catch (err) {
    // pdfjs throws PasswordException with name === "PasswordException".
    // Bubble that up as PdfPasswordRequiredError so callers can branch.
    if (err && typeof err === "object" && "name" in err && (err as Error).name === "PasswordException") {
      throw new PdfPasswordRequiredError();
    }
    console.error("[PDF] Text extraction failed, falling back to visual-only:", err instanceof Error ? err.message : err);
    return ""; // Caller handles empty text gracefully
  }
}

/**
 * Lightweight password-protection probe. Tries to open the PDF; if it
 * throws PasswordException, surfaces a PdfPasswordRequiredError. Other
 * errors are swallowed (we don't want to block extraction on a malformed
 * file the AI path can still recover from).
 *
 * Used at the top of the document agent so short-tier PDFs (which send raw
 * base64 to Claude without ever calling extractFullText) still trip the
 * password gate before reaching the model.
 */
export async function probePdfRequiresPassword(buffer: Buffer): Promise<boolean> {
  try {
    await getDocumentProxy(new Uint8Array(buffer));
    return false;
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && (err as Error).name === "PasswordException") {
      return true;
    }
    return false;
  }
}

/**
 * Password-aware sibling of analyzePdf. pdf-lib opens encrypted PDFs with
 * ignoreEncryption=true to read top-level metadata, but the page tree
 * dictionaries are still encrypted indirect references — calling
 * pdfDoc.getPageCount() walks that tree and blows up with
 * "Expected instance of PDFDict, but got instance of undefined".
 *
 * unpdf (pdfjs under the hood) decrypts the page tree natively when given
 * the password, so we use it for page counting on locked files. The rest
 * of the analysis collapses to a no-op since buildPdfContent's password
 * branch only consumes page_count anyway (it sends Claude text-only).
 */
export async function analyzePdfWithPassword(
  buffer: Buffer,
  password: string,
): Promise<PDFAnalysis> {
  let pageCount = 0;
  try {
    const proxy = await getDocumentProxy(new Uint8Array(buffer), { password });
    pageCount = proxy.numPages;
  } catch {
    // Wrong-password / corrupt-file errors will be surfaced downstream by
    // extractFullText. Returning a zero page count is cosmetic only.
  }
  return {
    page_count: pageCount,
    file_size: buffer.length,
    tier: "medium", // value unused — buildPdfContent's password branch ignores tier/strategy
    strategy: PAGE_STRATEGIES["_default"],
  };
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
  year: number | null,
  options?: { password?: string },
): Promise<unknown[]> {
  const content: unknown[] = [];

  // Password-protected path: send extracted text only. We can decrypt for
  // text via pdfjs but we'd have to re-encode the decrypted PDF to send a
  // visual base64 block, which is heavyweight. Text-only is good enough
  // for the common case (tax returns, K-1s) and keeps the unlock flow
  // simple. If quality is poor on a specific file, the user can decrypt
  // out-of-band and re-upload.
  if (options?.password) {
    const fullText = await extractFullText(buffer, options);
    if (fullText) {
      content.push({
        type: "text",
        text: `## Document Text (decrypted from password-protected PDF, ${analysis.page_count} pages)\n\n${fullText}`,
      });
    } else {
      content.push({
        type: "text",
        text: `## Document Text\n\n(Empty extraction — the PDF unlocked but pdfjs could not extract text.)`,
      });
    }
    return content;
  }

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
      const fullText = await extractFullText(buffer, options);
      if (fullText) {
        // Cap extracted text at ~120k tokens (~480k chars at 4 chars/token)
        // to leave room for visual pages, system prompt, and output budget.
        // Covers the "500-page deposition transcript" edge case where even
        // the text alone could blow the input budget.
        const MAX_TEXT_CHARS = 480_000;
        const clipped = fullText.length > MAX_TEXT_CHARS
          ? fullText.slice(0, MAX_TEXT_CHARS) +
            `\n\n[... text truncated: showing first ${MAX_TEXT_CHARS.toLocaleString()} of ${fullText.length.toLocaleString()} characters from ${analysis.page_count} total pages. Key terms are typically in the earlier pages; exhibits and schedules follow. Focus on extracting structured data from the text shown above plus the visual pages that follow.]`
          : fullText;
        content.push({
          type: "text",
          text: `## Full Document Text (${analysis.page_count} pages)\n\n${clipped}`,
        });
      }
      // If text extraction failed, we'll rely on visual pages only (below).
      // Don't send the whole PDF — Claude has a 100-page limit.
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
