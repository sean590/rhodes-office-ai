import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Module mocks (before imports) ------------------------------------------

const mockDownload = vi.fn();
const mockAnalyzePdf = vi.fn();
const mockBuildPdfContent = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        download: mockDownload,
      }),
    },
  }),
}));

vi.mock("@/lib/pipeline/pdf-processor", () => ({
  analyzePdf: (...args: unknown[]) => mockAnalyzePdf(...args),
  buildPdfContent: (...args: unknown[]) => mockBuildPdfContent(...args),
}));

import { contentBlocksForTurn, type ChatAttachment } from "../document-content";

beforeEach(() => {
  mockDownload.mockReset();
  mockAnalyzePdf.mockReset();
  mockBuildPdfContent.mockReset();
});

function makeBlob(content: string): Blob {
  return new Blob([content], { type: "application/octet-stream" });
}

function pdfAttachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    storage_path: "org/queue/batch/test.pdf",
    filename: "test.pdf",
    content_type: "application/pdf",
    size: 100_000,
    ...overrides,
  };
}

// =============================================================================
// PDF scenarios
// =============================================================================

describe("contentBlocksForTurn — PDF handling", () => {
  // Phase 1 of the chat unification: PDFs in chat are metadata-only. The
  // pipeline's document agent is the sole extractor — the orchestrator
  // never sees PDF bytes in its turn. These tests cover the metadata
  // preamble; buildPdfContent must NOT be called.

  it("small PDF (≤20 pages): emits metadata-only preamble, never calls buildPdfContent", async () => {
    mockDownload.mockResolvedValue({ data: makeBlob("fake-pdf"), error: null });
    mockAnalyzePdf.mockResolvedValue({
      tier: "short",
      page_count: 5,
      text_source: "embedded",
      chars_per_page: 500,
    });

    const result = await contentBlocksForTurn([pdfAttachment()]);

    expect(mockAnalyzePdf).toHaveBeenCalledTimes(1);
    expect(mockBuildPdfContent).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: "text", text: expect.stringContaining("test.pdf") }),
    );
    const text = (result[0] as { text: string }).text;
    expect(text).toContain("5 pages");
    expect(text).toContain("short");
    expect(text).toContain("pipeline");
  });

  it("medium PDF (21–100 pages): same metadata-only behavior, tier=medium", async () => {
    mockDownload.mockResolvedValue({ data: makeBlob("fake-pdf"), error: null });
    mockAnalyzePdf.mockResolvedValue({
      tier: "medium",
      page_count: 45,
      text_source: "embedded",
      chars_per_page: 400,
    });

    const result = await contentBlocksForTurn([pdfAttachment()]);

    expect(mockAnalyzePdf).toHaveBeenCalledTimes(1);
    expect(mockBuildPdfContent).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    const text = (result[0] as { text: string }).text;
    expect(text).toContain("45 pages");
    expect(text).toContain("medium");
  });

  it("long PDF (>100 pages): metadata-only, tier=long", async () => {
    mockDownload.mockResolvedValue({ data: makeBlob("fake-pdf"), error: null });
    mockAnalyzePdf.mockResolvedValue({
      tier: "long",
      page_count: 250,
      text_source: "embedded",
      chars_per_page: 300,
    });

    const result = await contentBlocksForTurn([pdfAttachment()]);

    expect(mockBuildPdfContent).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    const text = (result[0] as { text: string }).text;
    expect(text).toContain("250 pages");
    expect(text).toContain("long");
  });

  it("analyzePdf called with null as second arg (pipeline hasn't classified yet)", async () => {
    mockDownload.mockResolvedValue({ data: makeBlob("fake-pdf"), error: null });
    mockAnalyzePdf.mockResolvedValue({ tier: "short", page_count: 3 });

    await contentBlocksForTurn([pdfAttachment()]);

    expect(mockAnalyzePdf.mock.calls[0][1]).toBeNull();
  });

  it("analyzePdf failure (e.g. encrypted PDF) falls through to a softer preamble", async () => {
    mockDownload.mockResolvedValue({ data: makeBlob("encrypted-pdf"), error: null });
    mockAnalyzePdf.mockRejectedValue(new Error("Expected instance of PDFDict, but got instance of undefined"));

    const result = await contentBlocksForTurn([pdfAttachment()]);

    // Even when analyzePdf throws, we still emit a preamble (no
    // outer-catch fallback "couldn't be processed" message), so the
    // orchestrator knows the file was uploaded.
    expect(mockBuildPdfContent).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    const text = (result[0] as { text: string }).text;
    expect(text).toContain("test.pdf");
    expect(text).toContain("pipeline");
  });
});

// =============================================================================
// Image attachment
// =============================================================================

describe("contentBlocksForTurn — image handling", () => {
  it("base64 image block with correct media_type, no PDF processing", async () => {
    const imgBytes = Buffer.from("PNG-BYTES");
    mockDownload.mockResolvedValue({ data: new Blob([imgBytes]), error: null });

    const result = await contentBlocksForTurn([
      {
        storage_path: "org/queue/batch/photo.png",
        filename: "photo.png",
        content_type: "image/png",
        size: 5000,
      },
    ]);

    expect(mockAnalyzePdf).not.toHaveBeenCalled();
    expect(mockBuildPdfContent).not.toHaveBeenCalled();
    // Preamble + image block.
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({ type: "text", text: expect.stringContaining("photo.png") }),
    );
    const imgBlock = result[1] as {
      type: string;
      source: { type: string; media_type: string; data: string };
    };
    expect(imgBlock.type).toBe("image");
    expect(imgBlock.source.type).toBe("base64");
    expect(imgBlock.source.media_type).toBe("image/png");
    expect(imgBlock.source.data).toBe(imgBytes.toString("base64"));
  });
});

// =============================================================================
// Text file
// =============================================================================

describe("contentBlocksForTurn — text file handling", () => {
  it("inline text block with file contents", async () => {
    mockDownload.mockResolvedValue({ data: makeBlob("Hello, world!"), error: null });

    const result = await contentBlocksForTurn([
      {
        storage_path: "org/queue/batch/readme.txt",
        filename: "readme.txt",
        content_type: "text/plain",
        size: 13,
      },
    ]);

    expect(result).toHaveLength(1);
    expect((result[0] as { text: string }).text).toContain("Hello, world!");
    expect((result[0] as { text: string }).text).toContain("readme.txt");
  });

  it("truncates text at 480k chars with truncation notice", async () => {
    const hugeText = "x".repeat(500_000);
    mockDownload.mockResolvedValue({ data: makeBlob(hugeText), error: null });

    const result = await contentBlocksForTurn([
      {
        storage_path: "org/queue/batch/huge.txt",
        filename: "huge.txt",
        content_type: "text/plain",
        size: 500_000,
      },
    ]);

    const text = (result[0] as { text: string }).text;
    expect(text).toContain("truncated to 480k chars");
    // The actual content portion (after the header) should be capped.
    expect(text.length).toBeLessThan(500_000);
  });
});

// =============================================================================
// Unknown content type
// =============================================================================

describe("contentBlocksForTurn — unknown content type", () => {
  it("returns a reference-only text block", async () => {
    mockDownload.mockResolvedValue({ data: makeBlob("binary"), error: null });

    const result = await contentBlocksForTurn([
      {
        storage_path: "org/queue/batch/archive.zip",
        filename: "archive.zip",
        content_type: "application/zip",
        size: 99999,
      },
    ]);

    expect(result).toHaveLength(1);
    const text = (result[0] as { text: string }).text;
    expect(text).toContain("archive.zip");
    expect(text).toContain("application/zip");
    expect(text).toContain("cannot be displayed inline");
  });
});

// =============================================================================
// Error handling
// =============================================================================

describe("contentBlocksForTurn — error handling", () => {
  it("per-attachment failure: error block for failed, real blocks for successful", async () => {
    // First attachment fails download.
    mockDownload
      .mockRejectedValueOnce(new Error("storage timeout"))
      .mockResolvedValueOnce({ data: makeBlob("ok-content"), error: null });

    const result = await contentBlocksForTurn([
      {
        storage_path: "org/queue/batch/fail.pdf",
        filename: "fail.pdf",
        content_type: "text/plain",
        size: 100,
      },
      {
        storage_path: "org/queue/batch/ok.txt",
        filename: "ok.txt",
        content_type: "text/plain",
        size: 10,
      },
    ]);

    // Should NOT throw.
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First block: error notice for fail.pdf.
    const errorBlock = result[0] as { text: string };
    expect(errorBlock.text).toContain("fail.pdf");
    expect(errorBlock.text).toContain("could not be processed");
    // Second block: successful content for ok.txt.
    const okBlock = result[1] as { text: string };
    expect(okBlock.text).toContain("ok-content");
  });

  it("empty attachments array returns empty array", async () => {
    const result = await contentBlocksForTurn([]);
    expect(result).toEqual([]);
  });
});
