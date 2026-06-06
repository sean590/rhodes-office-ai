/**
 * Provider-suggestion logic (Phase 1 routing hub) — the hub "brain".
 *
 * Given a document, surface the providers that serve its entity, ranked by
 * discipline relevance to the document type. Shared by both the route
 * (GET /api/documents/[id]/provider-suggestions) and the get_provider_suggestions
 * MCP read tool, so the two front doors stay in parity — the read-side analog of
 * the send service.
 *
 * Ranking is SOFT: discipline relevance only reorders; a serving provider is
 * never filtered out for a discipline mismatch.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderContact } from "@/lib/types/entities";

export interface SuggestedProvider {
  id: string;
  name: string;
  disciplines: string[];
  domains: string[];
  default_contact_email: string | null;
  contacts: ProviderContact[];
  serves_all_entities: boolean;
  entity_ids: string[];
}

export interface ProviderSuggestion {
  provider: SuggestedProvider;
  matched_via: "entity" | "all_entities";
  recommended_recipient_email: string | null;
}

// Tolerant document-type → discipline hints. Substring match on a lowercased
// document_type slug/label; never authoritative, only nudges ranking.
const DISCIPLINE_HINTS: Array<{ needles: string[]; disciplines: string[] }> = [
  { needles: ["k1", "k-1", "tax", "return", "1099", "1040", "w2", "w-2", "estimate", "irs"], disciplines: ["tax"] },
  { needles: ["appraisal", "valuation", "409a"], disciplines: ["valuation"] },
  { needles: ["financial", "balance", "income", "ledger", "bookkeep", "p&l", "pnl", "statement", "payroll"], disciplines: ["bookkeeping"] },
  { needles: ["operating_agreement", "agreement", "legal", "gift", "estate", "trust_agreement", "formation", "bylaw"], disciplines: ["legal"] },
  { needles: ["trust"], disciplines: ["trustee"] },
  { needles: ["registration", "registered_agent", "annual_report", "statement_of_information"], disciplines: ["registered_agent"] },
  { needles: ["portfolio", "wealth", "investment_statement", "brokerage"], disciplines: ["wealth_mgmt"] },
];

export function relevantDisciplines(documentType: string | null): Set<string> {
  const out = new Set<string>();
  if (!documentType) return out;
  const t = documentType.toLowerCase();
  for (const { needles, disciplines } of DISCIPLINE_HINTS) {
    if (needles.some((n) => t.includes(n))) {
      for (const d of disciplines) out.add(d);
    }
  }
  return out;
}

export function recommendRecipient(p: {
  default_contact_email: string | null;
  contacts: ProviderContact[];
}): string | null {
  if (p.default_contact_email?.trim()) return p.default_contact_email.trim();
  const dflt = p.contacts?.find((c) => c.is_default && c.email?.trim());
  if (dflt) return dflt.email.trim();
  const first = p.contacts?.find((c) => c.email?.trim());
  return first ? first.email.trim() : null;
}

export async function getProviderSuggestions(
  supabase: SupabaseClient,
  orgId: string,
  documentId: string,
): Promise<ProviderSuggestion[]> {
  // 1. Load the document (org-scoped) for its entity_id + document_type.
  const { data: doc } = await supabase
    .from("documents")
    .select("id, entity_id, document_type")
    .eq("id", documentId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc) return [];

  // 2. Collect the document's entity ids: direct + any linked (primary/related).
  const { data: links } = await supabase
    .from("document_entity_links")
    .select("entity_id")
    .eq("organization_id", orgId)
    .eq("document_id", documentId);
  const entityIds = new Set<string>();
  if (doc.entity_id) entityIds.add(doc.entity_id);
  for (const l of links ?? []) if (l.entity_id) entityIds.add(l.entity_id);

  // 3. Load all live providers + the org's provider↔entity links.
  const [{ data: providers }, { data: spEntities }] = await Promise.all([
    supabase
      .from("service_providers")
      .select("id, name, disciplines, domains, default_contact_email, contacts, serves_all_entities")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
    supabase
      .from("service_provider_entities")
      .select("provider_id, entity_id")
      .eq("organization_id", orgId),
  ]);
  if (!providers || providers.length === 0) return [];

  // provider_id → all entity_ids it serves
  const byProvider = new Map<string, string[]>();
  for (const row of spEntities ?? []) {
    const arr = byProvider.get(row.provider_id) ?? [];
    arr.push(row.entity_id);
    byProvider.set(row.provider_id, arr);
  }

  const wanted = relevantDisciplines(doc.document_type);

  // 4. Keep providers that serve one of the doc's entities OR serve all.
  const suggestions: ProviderSuggestion[] = [];
  for (const p of providers) {
    const served = byProvider.get(p.id) ?? [];
    const entityMatch = served.some((eid) => entityIds.has(eid));
    if (!p.serves_all_entities && !entityMatch) continue;

    const contacts = (p.contacts as ProviderContact[]) ?? [];
    suggestions.push({
      provider: {
        id: p.id,
        name: p.name,
        disciplines: p.disciplines ?? [],
        domains: p.domains ?? [],
        default_contact_email: p.default_contact_email,
        contacts,
        serves_all_entities: p.serves_all_entities,
        entity_ids: served,
      },
      // A specific entity link is the stronger signal; prefer it over "all".
      matched_via: entityMatch ? "entity" : "all_entities",
      recommended_recipient_email: recommendRecipient({
        default_contact_email: p.default_contact_email,
        contacts,
      }),
    });
  }

  // 5. Soft rank: discipline relevance desc, then entity-match before all-entities,
  //    then name. Never filters — only reorders.
  suggestions.sort((a, b) => {
    const aRel = a.provider.disciplines.filter((d) => wanted.has(d)).length;
    const bRel = b.provider.disciplines.filter((d) => wanted.has(d)).length;
    if (aRel !== bRel) return bRel - aRel;
    if (a.matched_via !== b.matched_via) return a.matched_via === "entity" ? -1 : 1;
    return a.provider.name.localeCompare(b.provider.name);
  });

  return suggestions;
}
