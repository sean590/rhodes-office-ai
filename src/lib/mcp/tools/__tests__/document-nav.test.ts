import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../../tool-context";

// --- Module mocks -----------------------------------------------------------

vi.mock("@/lib/utils/audit", () => ({
  logAuditEvent: async () => {},
}));

const mockExtractPageRange = vi.fn();
const mockExtractFullText = vi.fn();

vi.mock("@/lib/pipeline/pdf-processor", () => ({
  analyzePdf: vi.fn(),
  buildPdfContent: vi.fn(),
  extractPageRange: (...args: unknown[]) => mockExtractPageRange(...args),
  extractFullText: (...args: unknown[]) => mockExtractFullText(...args),
}));

// Ownership check — default to success; individual tests override.
const mockOwnership = vi.fn();
vi.mock("../../ownership", () => ({
  verifyResourceOwnership: (...args: unknown[]) => mockOwnership(...args),
}));

import {
  getDocumentOutlineTool,
  getDocumentSectionTool,
  searchDocumentTextTool,
} from "../document-nav";

// --- Supabase mock -----------------------------------------------------------

type Resp = { data?: unknown; error?: unknown };

function makeCtx(
  orgId: string,
  dbScript: Record<string, Resp[]>,
  storageScript?: { download: Resp[] },
): ToolContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const passthrough = () => chain;
  chain.select = passthrough;
  chain.eq = passthrough;
  chain.is = passthrough;
  chain.ilike = passthrough;
  chain.order = passthrough;
  chain.limit = passthrough;
  chain.neq = passthrough;
  chain.lte = passthrough;
  chain.lt = passthrough;
  chain.gte = passthrough;
  chain.in = passthrough;
  chain.insert = () => Promise.resolve({ data: null, error: null });
  chain.single = () => {
    const queue = dbScript.documents ?? [];
    return Promise.resolve(queue.shift() ?? { data: null, error: null });
  };
  chain.maybeSingle = chain.single;
  chain.then = (resolve: (v: Resp) => unknown) => {
    const queue = dbScript.documents ?? [];
    return resolve(queue.shift() ?? { data: [], error: null });
  };

  const storageQueue = storageScript?.download ?? [];
  return {
    userId: "u",
    orgId,
    sessionId: "s",
    supabase: {
      from: () => chain,
      storage: {
        from: () => ({
          download: () => Promise.resolve(storageQueue.shift() ?? { data: null, error: null }),
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    redact: (o) => o,
  };
}

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mockOwnership.mockReset().mockResolvedValue(undefined);
  mockExtractPageRange.mockReset();
  mockExtractFullText.mockReset();
});

// =============================================================================
// get_document_outline
// =============================================================================

describe("get_document_outline", () => {
  it("returns full metadata when ai_extraction is populated", async () => {
    const ctx = makeCtx("org-A", {
      documents: [
        {
          data: {
            id: VALID_UUID,
            name: "operating-agreement.pdf",
            document_type: "operating_agreement",
            document_category: "legal",
            year: 2024,
            mime_type: "application/pdf",
            file_size: 500_000,
            ai_extracted: true,
            ai_extraction: {
              page_count: 45,
              tier: "medium",
              sections: ["Cover", "Article I", "Article II"],
              toc: null,
              detected_forms: null,
            },
          },
          error: null,
        },
      ],
    });

    const result = await getDocumentOutlineTool.handler(
      { document_id: VALID_UUID },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.page_count).toBe(45);
    expect(d.tier).toBe("medium");
    expect(d.sections).toEqual(["Cover", "Article I", "Article II"]);
    expect(d.pipeline_status).toBe("complete");
    expect(d.name).toBe("operating-agreement.pdf");
  });

  it("returns basic metadata with in_progress when pipeline hasn't finished", async () => {
    const ctx = makeCtx("org-A", {
      documents: [
        {
          data: {
            id: VALID_UUID,
            name: "new-upload.pdf",
            document_type: "other",
            document_category: null,
            year: null,
            mime_type: "application/pdf",
            file_size: 200_000,
            ai_extracted: false,
            ai_extraction: null,
          },
          error: null,
        },
      ],
    });

    const result = await getDocumentOutlineTool.handler(
      { document_id: VALID_UUID },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.pipeline_status).toBe("in_progress");
    expect(d.page_count).toBeNull();
    expect(d.name).toBe("new-upload.pdf");
  });

  it("throws when ownership check fails", async () => {
    mockOwnership.mockRejectedValue(new Error("not found"));
    const ctx = makeCtx("org-A", {});
    await expect(
      getDocumentOutlineTool.handler({ document_id: VALID_UUID }, ctx),
    ).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// get_document_section
// =============================================================================

describe("get_document_section", () => {
  it("returns extracted text for a valid page range", async () => {
    const pdfBuffer = Buffer.from("fake-pdf");
    const pageBuffer = Buffer.from("page-subset");
    mockExtractPageRange.mockResolvedValue(pageBuffer);
    mockExtractFullText.mockResolvedValue("Text from pages 1 through 5.");

    const ctx = makeCtx(
      "org-A",
      {
        documents: [{ data: { file_path: "org/docs/test.pdf" }, error: null }],
      },
      { download: [{ data: new Blob([pdfBuffer]), error: null }] },
    );

    const result = await getDocumentSectionTool.handler(
      { document_id: VALID_UUID, section_ref: "pages:1-5" },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.text).toBe("Text from pages 1 through 5.");
    expect(d.pages).toBe("1-5");
    expect(d.truncated).toBe(false);
    expect(mockExtractPageRange).toHaveBeenCalledWith(
      expect.any(Buffer),
      [[1, 5]],
    );
  });

  it("truncates text at 30k tokens (120k chars) and sets truncated flag", async () => {
    const hugeText = "x".repeat(150_000);
    mockExtractPageRange.mockResolvedValue(Buffer.from("subset"));
    mockExtractFullText.mockResolvedValue(hugeText);

    const ctx = makeCtx(
      "org-A",
      {
        documents: [{ data: { file_path: "org/docs/big.pdf" }, error: null }],
      },
      { download: [{ data: new Blob([Buffer.from("pdf")]), error: null }] },
    );

    const result = await getDocumentSectionTool.handler(
      { document_id: VALID_UUID, section_ref: "pages:1-50" },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.truncated).toBe(true);
    expect((d.text as string).length).toBeLessThanOrEqual(120_001);
  });

  it("returns error for invalid section_ref format", async () => {
    const ctx = makeCtx("org-A", {});
    const result = await getDocumentSectionTool.handler(
      { document_id: VALID_UUID, section_ref: "chapter:3" },
      ctx,
    );
    const d = result.data as Record<string, unknown>;
    expect(d.error).toContain("Invalid section_ref");
  });

  it("throws when ownership check fails", async () => {
    mockOwnership.mockRejectedValue(new Error("not found"));
    const ctx = makeCtx("org-A", {});
    await expect(
      getDocumentSectionTool.handler(
        { document_id: VALID_UUID, section_ref: "pages:1-5" },
        ctx,
      ),
    ).rejects.toThrow(/not found/);
  });
});

// =============================================================================
// search_document_text
// =============================================================================

describe("search_document_text", () => {
  it("finds matching snippets from ai_extraction.full_text", async () => {
    const fullText = "The quick brown fox jumps over the lazy dog. The fox is clever.";
    const ctx = makeCtx("org-A", {
      documents: [
        {
          data: {
            file_path: "org/docs/doc.pdf",
            ai_extraction: { full_text: fullText },
          },
          error: null,
        },
      ],
    });

    const result = await searchDocumentTextTool.handler(
      { document_id: VALID_UUID, query: "fox", max_results: 5 },
      ctx,
    );
    const d = result.data as { results: Array<{ snippet: string }>; total_text_length: number };
    expect(d.results.length).toBe(2);
    expect(d.results[0].snippet).toContain("fox");
    expect(d.results[1].snippet).toContain("fox");
    expect(d.total_text_length).toBe(fullText.length);
  });

  it("returns empty results for no matches", async () => {
    const ctx = makeCtx("org-A", {
      documents: [
        {
          data: {
            file_path: "org/docs/doc.pdf",
            ai_extraction: { full_text: "Hello world." },
          },
          error: null,
        },
      ],
    });

    const result = await searchDocumentTextTool.handler(
      { document_id: VALID_UUID, query: "elephant", max_results: 5 },
      ctx,
    );
    const d = result.data as { results: unknown[] };
    expect(d.results).toHaveLength(0);
  });

  it("extracts text on-demand from Storage when ai_extraction is null", async () => {
    mockExtractFullText.mockResolvedValue("On-demand extracted text with keyword TARGET inside.");

    const ctx = makeCtx(
      "org-A",
      {
        documents: [
          {
            data: { file_path: "org/docs/pending.pdf", ai_extraction: null },
            error: null,
          },
        ],
      },
      { download: [{ data: new Blob([Buffer.from("pdf")]), error: null }] },
    );

    const result = await searchDocumentTextTool.handler(
      { document_id: VALID_UUID, query: "TARGET", max_results: 5 },
      ctx,
    );
    const d = result.data as { results: Array<{ snippet: string }> };
    expect(mockExtractFullText).toHaveBeenCalledTimes(1);
    expect(d.results.length).toBe(1);
    expect(d.results[0].snippet).toContain("TARGET");
  });

  it("respects max_results", async () => {
    const fullText = "cat cat cat cat cat cat cat cat cat cat";
    const ctx = makeCtx("org-A", {
      documents: [
        {
          data: {
            file_path: "org/docs/cats.pdf",
            ai_extraction: { full_text: fullText },
          },
          error: null,
        },
      ],
    });

    const result = await searchDocumentTextTool.handler(
      { document_id: VALID_UUID, query: "cat", max_results: 2 },
      ctx,
    );
    const d = result.data as { results: unknown[] };
    expect(d.results.length).toBe(2);
  });
});
