/**
 * Unit tests for getProviderSuggestions — entity matching, serves_all_entities,
 * discipline-relevance ranking, and recipient resolution. A canned per-table
 * mock stands in for Supabase.
 */

import { describe, it, expect } from "vitest";
import { getProviderSuggestions } from "../suggestions";

const E1 = "e1111111-1111-4111-8111-111111111111";
const E2 = "e2222222-2222-4222-8222-222222222222";

// Per-table mock: from(table) returns a chainable, awaitable builder that
// resolves to the canned rows for that table; maybeSingle() yields the single.
function makeSupabase(tables: Record<string, unknown>) {
  function builder(table: string) {
    const rows = tables[table];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) chain[m] = self;
    chain.maybeSingle = () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null });
    chain.single = chain.maybeSingle;
    // Awaiting the builder resolves to the list form.
    chain.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: Array.isArray(rows) ? rows : rows ? [rows] : [], error: null });
    return chain;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => builder(t) } as any;
}

const ORG = "org-1";
const DOC = "d1111111-1111-4111-8111-111111111111";

describe("getProviderSuggestions", () => {
  it("includes serving + all-entities providers, excludes non-serving, ranks by discipline", async () => {
    const supabase = makeSupabase({
      documents: { id: DOC, entity_id: E1, document_type: "2024_k1" },
      document_entity_links: [],
      service_providers: [
        { id: "p-bpw", name: "BPW", disciplines: ["bookkeeping"], domains: [], default_contact_email: "books@bpw.com", contacts: [], serves_all_entities: false },
        { id: "p-andersen", name: "Andersen", disciplines: ["tax", "valuation"], domains: [], default_contact_email: null, contacts: [{ name: "Lori", email: "lori@andersen.com", is_default: true }], serves_all_entities: true },
        { id: "p-legal", name: "Willkie", disciplines: ["legal"], domains: [], default_contact_email: "x@willkie.com", contacts: [], serves_all_entities: false },
      ],
      service_provider_entities: [
        { provider_id: "p-bpw", entity_id: E1 },
        { provider_id: "p-legal", entity_id: E2 }, // serves a different entity → excluded
      ],
    });

    const result = await getProviderSuggestions(supabase, ORG, DOC);

    // Willkie excluded (serves E2, not E1, not all-entities).
    expect(result.map((s) => s.provider.name)).toEqual(["Andersen", "BPW"]);

    // K-1 → tax relevance ranks Andersen (tax) above BPW (bookkeeping).
    expect(result[0].provider.name).toBe("Andersen");
    expect(result[0].matched_via).toBe("all_entities");
    expect(result[0].recommended_recipient_email).toBe("lori@andersen.com"); // default contact

    expect(result[1].provider.name).toBe("BPW");
    expect(result[1].matched_via).toBe("entity");
    expect(result[1].recommended_recipient_email).toBe("books@bpw.com"); // default_contact_email

    // ★-scope: only the tax firm is discipline-relevant to a K-1, not BPW.
    expect(result.find((s) => s.provider.name === "Andersen")?.relevant).toBe(true);
    expect(result.find((s) => s.provider.name === "BPW")?.relevant).toBe(false);
  });

  it("returns [] when the document isn't found in the org", async () => {
    const supabase = makeSupabase({
      documents: null,
      document_entity_links: [],
      service_providers: [],
      service_provider_entities: [],
    });
    const result = await getProviderSuggestions(supabase, ORG, DOC);
    expect(result).toEqual([]);
  });
});
