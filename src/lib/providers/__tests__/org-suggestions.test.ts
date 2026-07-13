/**
 * Unit tests for getOrgSendSuggestions — the proactive "Suggested sends" engine.
 * Verifies grouping by provider, the K-1-yes/financials-no behavior (route_to
 * only, no keyword leakage), and exclusion of already-sent/dismissed/vetoed.
 */

import { describe, it, expect } from "vitest";
import { getOrgSendSuggestions } from "../routing-rules";

const E1 = "e1111111-1111-4111-8111-111111111111";
const ANDERSEN = "p-andersen";
const BPW = "p-bpw";
const K1A = "doc-k1-a";
const K1B = "doc-k1-b";
const FIN = "doc-financials";

// Per-table canned mock supporting the engine's query shapes.
function makeSupabase(tables: Record<string, unknown[]>) {
  function builder(table: string) {
    const rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "is", "in", "not", "gte", "neq", "order", "limit"]) chain[m] = self;
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows, error: null });
    return chain;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => builder(t) } as any;
}

const BASE = {
  documents: [
    { id: K1A, name: "44 Holdings K-1", document_type: "k1", entity_id: E1, source_provider_id: null, created_at: "2026-06-01" },
    { id: K1B, name: "DG24 K-1", document_type: "k1", entity_id: E1, source_provider_id: null, created_at: "2026-06-01" },
    { id: FIN, name: "909 Park April Financials", document_type: "financial_statement", entity_id: E1, source_provider_id: null, created_at: "2026-06-01" },
  ],
  service_providers: [
    { id: ANDERSEN, name: "Andersen", disciplines: ["tax"], default_contact_email: "tax@andersen.com", contacts: [], serves_all_entities: true },
    { id: BPW, name: "BPW", disciplines: ["bookkeeping"], default_contact_email: "books@bpw.com", contacts: [], serves_all_entities: false },
  ],
  service_provider_entities: [{ provider_id: BPW, entity_id: E1 }],
  document_types: [
    { slug: "k1", route_to_disciplines: ["tax"] },
    { slug: "financial_statement", route_to_disciplines: [] }, // nobody — produced by the bookkeeper
  ],
  org_provider_routing_rules: [],
  provider_document_sends: [],
  provider_document_send_documents: [],
  provider_send_dismissals: [],
};

const ORG = "org-1";

describe("getOrgSendSuggestions", () => {
  it("bundles the K-1s for the tax firm and drops the financials", async () => {
    const result = await getOrgSendSuggestions(makeSupabase(BASE), ORG);
    // One suggestion: both K-1s → Andersen. Financials excluded (route_to empty,
    // and a keyword 'financial→bookkeeping' must NOT leak it to BPW).
    expect(result).toHaveLength(1);
    expect(result[0].provider.id).toBe(ANDERSEN);
    expect(result[0].documents.map((d) => d.id).sort()).toEqual([K1A, K1B].sort());
    expect(result.some((s) => s.documents.some((d) => d.id === FIN))).toBe(false);
  });

  it("excludes a (doc, provider) pair already sent", async () => {
    const sent = {
      ...BASE,
      provider_document_sends: [{ id: "send-1", provider_id: ANDERSEN, status: "sent" }],
      provider_document_send_documents: [{ send_id: "send-1", document_id: K1A }],
    };
    const result = await getOrgSendSuggestions(makeSupabase(sent), ORG);
    expect(result[0].documents.map((d) => d.id)).toEqual([K1B]); // K1A already sent
  });

  it("excludes a dismissed suggestion", async () => {
    const dismissed = {
      ...BASE,
      provider_send_dismissals: [{ document_id: K1A, provider_id: ANDERSEN }],
    };
    const result = await getOrgSendSuggestions(makeSupabase(dismissed), ORG);
    expect(result[0].documents.map((d) => d.id)).toEqual([K1B]);
  });

  it("vetoes routing a document back to the provider it came from", async () => {
    const fromAndersen = {
      ...BASE,
      documents: BASE.documents.map((d) => (d.id === K1A ? { ...d, source_provider_id: ANDERSEN } : d)),
    };
    const result = await getOrgSendSuggestions(makeSupabase(fromAndersen), ORG);
    expect(result[0].documents.map((d) => d.id)).toEqual([K1B]); // K1A came from Andersen
  });

  it("surfaces a learned rule even with no route_to discipline", async () => {
    // BPW learned to receive financials (user has sent them before).
    const learned = {
      ...BASE,
      org_provider_routing_rules: [{ document_type: "financial_statement", provider_id: BPW, times_confirmed: 2, times_dismissed: 0 }],
    };
    const result = await getOrgSendSuggestions(makeSupabase(learned), ORG);
    const bpw = result.find((s) => s.provider.id === BPW);
    expect(bpw?.documents.map((d) => d.id)).toEqual([FIN]);
    expect(bpw?.learned).toBe(true);
  });
});
