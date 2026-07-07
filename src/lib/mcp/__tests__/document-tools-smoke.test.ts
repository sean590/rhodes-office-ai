/**
 * Functional smoke tests for document-domain MCP tools.
 *
 * Covers:
 *   - link_document_to_entity / link_document_to_investment
 *   - unlink_document / archive_document
 *   - update_document (both rename + reclassify dryRun paths)
 *   - list_queue_items (read — filter through document_batches org scope)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../tool-context";

// ── Mocks (must precede imports) ──────────────────────────────────

const dispatchMock = vi.fn();
vi.mock("@/lib/mcp/apply-dispatch", () => ({
  dispatchAction: (...args: unknown[]) => dispatchMock(...args),
}));

const ownershipMock = vi.fn();
vi.mock("@/lib/mcp/ownership", () => ({
  verifyResourceOwnership: (...args: unknown[]) => ownershipMock(...args),
}));

const resolveNameMock = vi.fn();
vi.mock("@/lib/mcp/resolve-names", () => ({
  resolveName: (...args: unknown[]) => resolveNameMock(...args),
}));

import {
  linkDocumentToEntityTool,
  linkDocumentToInvestmentTool,
  unlinkDocumentTool,
  archiveDocumentTool,
  updateDocumentTool,
} from "../tools/documents-write";
import { listQueueItemsTool } from "../tools/document-nav";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const ENTITY_ID = "22222222-2222-4222-8222-222222222222";
const INVESTMENT_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "44444444-4444-4444-8444-444444444444";
const ORG_ID = "55555555-5555-4555-8555-555555555555";

type DbScript = Record<string, Array<{ data?: unknown; error?: unknown }>>;
let currentDb: DbScript = {};

function setDb(db: DbScript) {
  currentDb = db;
}

function makeSupabase() {
  const db = () => currentDb;
  const makeChain = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    const pass = () => chain;
    chain.select = pass;
    chain.eq = pass;
    chain.neq = pass;
    chain.in = pass;
    chain.is = pass;
    chain.not = pass;
    chain.lt = pass;
    chain.lte = pass;
    chain.gte = pass;
    chain.ilike = pass;
    chain.order = pass;
    chain.limit = pass;

    const consume = () => {
      const queue = db()[table] ?? [];
      return queue.shift() ?? { data: [], error: null };
    };
    chain.single = () => Promise.resolve(consume());
    chain.maybeSingle = chain.single;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(consume());
    return chain;
  };
  return { from: (table: string) => makeChain(table) };
}

function makeCtx(): ToolContext {
  return {
    userId: "user-1",
    orgId: ORG_ID,
    orgRole: "owner",
    sessionId: "sess-1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: makeSupabase() as any,
    redact: (o) => o,
  };
}

beforeEach(() => {
  setDb({});
  dispatchMock.mockReset().mockResolvedValue({
    data: { id: "stub-id" },
    audit_event_id: "audit-1",
  });
  ownershipMock.mockReset().mockResolvedValue(undefined);
  resolveNameMock.mockReset().mockResolvedValue("Test Doc");
});

// ═══════════════════════════════════════════════════════════════════
// Write: link / unlink / archive
// ═══════════════════════════════════════════════════════════════════

describe("link/unlink/archive document tools — dispatch routing", () => {
  it("link_document_to_entity dispatches link_document_to_entity", async () => {
    const ctx = makeCtx();
    await linkDocumentToEntityTool.handler(
      { document_id: DOC_ID, entity_id: ENTITY_ID },
      ctx,
    );
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "link_document_to_entity", {
      document_id: DOC_ID,
      entity_id: ENTITY_ID,
    });
  });

  it('link_document_to_entity dryRun returns \'Link "{doc}" to {entity}\'', async () => {
    resolveNameMock.mockResolvedValueOnce("ein-letter.pdf").mockResolvedValueOnce("Acme LLC");
    const result = await linkDocumentToEntityTool.dryRun!(
      { document_id: DOC_ID, entity_id: ENTITY_ID },
      makeCtx(),
    );
    expect(result.summary).toBe(`Link "ein-letter.pdf" to Acme LLC`);
  });

  it("link_document_to_investment dispatches link_document_to_investment", async () => {
    const ctx = makeCtx();
    await linkDocumentToInvestmentTool.handler(
      { document_id: DOC_ID, investment_id: INVESTMENT_ID },
      ctx,
    );
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "link_document_to_investment", {
      investment_id: INVESTMENT_ID,
      document_id: DOC_ID,
    });
  });

  it("unlink_document dispatches unlink_document with scope", async () => {
    const ctx = makeCtx();
    await unlinkDocumentTool.handler({ document_id: DOC_ID, scope: "entity" }, ctx);
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "unlink_document", {
      document_id: DOC_ID,
      scope: "entity",
    });
  });

  it("archive_document dispatches archive_document", async () => {
    const ctx = makeCtx();
    await archiveDocumentTool.handler({ document_id: DOC_ID }, ctx);
    expect(dispatchMock).toHaveBeenCalledWith(ctx, "archive_document", { document_id: DOC_ID });
  });

  it('archive_document dryRun returns \'Archive "{doc}"\'', async () => {
    resolveNameMock.mockResolvedValueOnce("old-contract.pdf");
    const result = await archiveDocumentTool.dryRun!({ document_id: DOC_ID }, makeCtx());
    expect(result.summary).toBe(`Archive "old-contract.pdf"`);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Write: update_document (smart dryRun paths)
// ═══════════════════════════════════════════════════════════════════

describe("update_document — smart dryRun summaries", () => {
  it("rename-only dryRun uses rename phrasing", async () => {
    resolveNameMock.mockResolvedValueOnce("old.pdf");
    const result = await updateDocumentTool.dryRun!(
      { document_id: DOC_ID, name: "2024 K-1.pdf" },
      makeCtx(),
    );
    expect(result.summary).toBe(`Rename "old.pdf" to "2024 K-1.pdf"`);
  });

  it("reclassify-only dryRun uses DOCUMENT_TYPE_LABELS", async () => {
    resolveNameMock.mockResolvedValueOnce("some-cert.pdf");
    const result = await updateDocumentTool.dryRun!(
      { document_id: DOC_ID, document_type: "certificate_of_formation" },
      makeCtx(),
    );
    expect(result.summary).toBe(`Reclassify "some-cert.pdf" as Certificate of Formation`);
  });

  it("reclassify plus other fields calls out the extras", async () => {
    resolveNameMock.mockResolvedValueOnce("doc.pdf");
    const result = await updateDocumentTool.dryRun!(
      {
        document_id: DOC_ID,
        document_type: "operating_agreement",
        document_category: "formation",
        year: 2024,
      },
      makeCtx(),
    );
    expect(result.summary).toContain("Reclassify");
    expect(result.summary).toContain("Operating Agreement");
    expect(result.summary).toContain("also updating");
  });

  it("handler dispatches update_document with input fields", async () => {
    const ctx = makeCtx();
    await updateDocumentTool.handler(
      { document_id: DOC_ID, document_type: "k1", year: 2024 },
      ctx,
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      ctx,
      "update_document",
      expect.objectContaining({ document_id: DOC_ID, document_type: "k1", year: 2024 }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Read: list_queue_items
// ═══════════════════════════════════════════════════════════════════

describe("list_queue_items (read)", () => {
  it("returns queue items scoped through document_batches org filter", async () => {
    setDb({
      document_batches: [{ data: [{ id: BATCH_ID }], error: null }],
      document_queue: [
        {
          data: [
            {
              id: "q1",
              original_filename: "file.pdf",
              status: "review_ready",
              ai_document_type: "operating_agreement",
              batch_id: BATCH_ID,
            },
          ],
          error: null,
        },
      ],
    });
    const result = await listQueueItemsTool.handler({ limit: 20 }, makeCtx());
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as unknown[])[0]).toMatchObject({
      id: "q1",
      original_filename: "file.pdf",
      status: "review_ready",
    });
  });

  it("returns empty when the org has no batches", async () => {
    setDb({
      document_batches: [{ data: [], error: null }],
    });
    const result = await listQueueItemsTool.handler({ limit: 20 }, makeCtx());
    expect(result.data).toEqual([]);
  });

  it("returns empty when an unknown batch_id is passed", async () => {
    setDb({
      document_batches: [{ data: null, error: null }],
    });
    const result = await listQueueItemsTool.handler(
      { batch_id: BATCH_ID, limit: 20 },
      makeCtx(),
    );
    expect(result.data).toEqual([]);
  });
});
