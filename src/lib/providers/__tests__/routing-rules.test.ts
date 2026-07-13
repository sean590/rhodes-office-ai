/**
 * Unit tests for getRoutingSuggestions — the proactive, learned routing logic:
 * learned rules beat seeded priors, the source provider is vetoed, keyword
 * priors cover AI-minted types, and providers with no routing reason are not
 * suggested (non-naggy).
 */

import { describe, it, expect } from "vitest";
import { getRoutingSuggestions } from "../routing-rules";

const E1 = "e1111111-1111-4111-8111-111111111111";
const DOC = "d1111111-1111-4111-8111-111111111111";
const ORG = "org-1";
const ANDERSEN = "p-andersen";
const BPW = "p-bpw";

// Per-table canned mock (maybeSingle → single/first row; await → list).
function makeSupabase(tables: Record<string, unknown>) {
  function builder(table: string) {
    const rows = tables[table];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = self;
    chain.maybeSingle = () =>
      Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows ?? null, error: null });
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: Array.isArray(rows) ? rows : rows ? [rows] : [], error: null });
    return chain;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => builder(t) } as any;
}

const PROVIDERS = [
  { id: ANDERSEN, name: "Andersen", disciplines: ["tax", "valuation"], default_contact_email: "tax@andersen.com", contacts: [], serves_all_entities: true },
  { id: BPW, name: "BPW", disciplines: ["bookkeeping"], default_contact_email: "books@bpw.com", contacts: [], serves_all_entities: false },
];

describe("getRoutingSuggestions", () => {
  it("ranks a learned rule above a discipline-only match", async () => {
    const supabase = makeSupabase({
      documents: { id: DOC, entity_id: E1, document_type: "k1", source_provider_id: null },
      document_entity_links: [],
      document_types: { route_to_disciplines: ["tax"] },
      org_provider_routing_rules: [{ provider_id: BPW, times_confirmed: 3, times_dismissed: 0, confidence: 1 }],
      service_providers: PROVIDERS,
      service_provider_entities: [{ provider_id: BPW, entity_id: E1 }],
    });

    const result = await getRoutingSuggestions(supabase, ORG, DOC);
    // BPW was taught (learned) → ranks first despite being the "wrong" discipline.
    expect(result[0].provider.id).toBe(BPW);
    expect(result[0].learned).toBe(true);
    // Andersen still suggested via the tax discipline prior.
    expect(result[1].provider.id).toBe(ANDERSEN);
    expect(result[1].learned).toBe(false);
  });

  it("vetoes the provider the document came from, and stays quiet otherwise", async () => {
    const supabase = makeSupabase({
      documents: { id: DOC, entity_id: E1, document_type: "k1", source_provider_id: ANDERSEN },
      document_entity_links: [],
      document_types: { route_to_disciplines: ["tax"] },
      org_provider_routing_rules: [],
      service_providers: PROVIDERS,
      service_provider_entities: [{ provider_id: BPW, entity_id: E1 }],
    });

    const result = await getRoutingSuggestions(supabase, ORG, DOC);
    // Andersen vetoed (it sent the K-1); BPW has no routing reason → not naggy.
    expect(result).toEqual([]);
  });

  it("uses keyword priors for AI-minted types with no seed row", async () => {
    const supabase = makeSupabase({
      documents: { id: DOC, entity_id: E1, document_type: "valuation_report", source_provider_id: null },
      document_entity_links: [],
      document_types: null, // AI-minted, no route_to_disciplines row
      org_provider_routing_rules: [],
      service_providers: PROVIDERS,
      service_provider_entities: [],
    });

    const result = await getRoutingSuggestions(supabase, ORG, DOC);
    // 'valuation_report' → valuation hint → Andersen (valuation discipline) matches.
    expect(result.map((r) => r.provider.id)).toEqual([ANDERSEN]);
    expect(result[0].learned).toBe(false);
    expect(result[0].recommended_recipient_email).toBe("tax@andersen.com");
  });
});
