/**
 * Learned, per-org send routing (Phase 1 follow-on groundwork).
 *
 * `getRoutingSuggestions` answers "which providers should this document be
 * PROACTIVELY routed to" — the stricter, push-style cousin of
 * suggestions.ts::getProviderSuggestions (which lists every serving provider
 * for the manual send card). It only surfaces a provider when there's an actual
 * routing reason, so it stays non-naggy:
 *
 *   reason = learned rule (org_provider_routing_rules)   ← strongest, user taught it
 *          | seeded route_to_disciplines ∩ provider.disciplines
 *          | keyword-hint disciplines ∩ provider.disciplines   ← cold start
 *   minus  = the provider the document came from (source_provider_id veto)
 *
 * `recordRoutingDecision` is the learning hook: every real send strengthens the
 * (document_type → provider) rule for that org. Mirrors org_document_patterns.
 *
 * Surfacing at ingestion time is deferred until a delivery path exists; these
 * functions are the dormant groundwork.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderContact } from "@/lib/types/entities";
import { relevantDisciplines, recommendRecipient } from "./suggestions";

export interface RoutingSuggestion {
  provider: {
    id: string;
    name: string;
    disciplines: string[];
    serves_all_entities: boolean;
  };
  recommended_recipient_email: string | null;
  /** Why this was suggested — shown to the user. */
  reason: string;
  /** True when the suggestion comes from a learned rule (user has sent this type before). */
  learned: boolean;
  score: number;
}

/**
 * Decay a routing rule when the user dismisses a suggestion: increment
 * times_dismissed and recompute confidence. Only decays an existing rule (a
 * dismissal never creates one). Best-effort.
 */
export async function recordRoutingDismissal(
  admin: SupabaseClient,
  orgId: string,
  documentType: string | null,
  providerId: string,
): Promise<void> {
  if (!documentType) return;
  try {
    const { data: existing } = await admin
      .from("org_provider_routing_rules")
      .select("id, times_confirmed, times_dismissed")
      .eq("organization_id", orgId)
      .eq("document_type", documentType)
      .eq("provider_id", providerId)
      .maybeSingle();
    if (!existing) return;
    const dismissed = (existing.times_dismissed ?? 0) + 1;
    const confirmed = existing.times_confirmed ?? 0;
    await admin
      .from("org_provider_routing_rules")
      .update({
        times_dismissed: dismissed,
        confidence: confirmed + dismissed > 0 ? confirmed / (confirmed + dismissed) : 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } catch (err) {
    console.error("[routing] recordRoutingDismissal failed:", err);
  }
}

// --- Org-wide proactive suggestions ("Suggested sends") ---------------------

export interface OrgSendSuggestion {
  provider: { id: string; name: string; disciplines: string[] };
  recommended_recipient_email: string | null;
  documents: Array<{ id: string; name: string; document_type: string | null }>;
  /** True if any document matched a learned rule (vs only a discipline prior). */
  learned: boolean;
}

/**
 * Scan the org's recent documents and propose grouped bundle sends: for each
 * document, the providers that serve its entity AND have a routing reason
 * (learned rule or discipline match), minus the source-provider veto, minus
 * anything already sent to that provider, minus dismissed suggestions. Grouped
 * by provider so "3 K-1s → Andersen" is one suggestion. Powers the lazy,
 * non-naggy "Suggested sends" surface.
 */
export async function getOrgSendSuggestions(
  supabase: SupabaseClient,
  orgId: string,
  opts: { windowDays?: number; maxDocs?: number } = {},
): Promise<OrgSendSuggestion[]> {
  const windowDays = opts.windowDays ?? 60;
  const maxDocs = opts.maxDocs ?? 300;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: docRows } = await supabase
    .from("documents")
    .select("id, name, document_type, entity_id, source_provider_id, created_at")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .not("entity_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(maxDocs);
  const docs = docRows ?? [];
  if (docs.length === 0) return [];

  const [{ data: providers }, { data: spEntities }, { data: rules }, { data: typeRows }, sentPairs, dismissedPairs] =
    await Promise.all([
      supabase
        .from("service_providers")
        .select("id, name, disciplines, default_contact_email, contacts, serves_all_entities")
        .eq("organization_id", orgId)
        .is("deleted_at", null),
      supabase.from("service_provider_entities").select("provider_id, entity_id").eq("organization_id", orgId),
      supabase
        .from("org_provider_routing_rules")
        .select("document_type, provider_id, times_confirmed, times_dismissed")
        .eq("organization_id", orgId)
        .eq("is_active", true),
      supabase.from("document_types").select("slug, route_to_disciplines"),
      loadSentPairs(supabase, orgId),
      loadDismissedPairs(supabase, orgId),
    ]);
  if (!providers || providers.length === 0) return [];

  const servedByProvider = new Map<string, Set<string>>();
  for (const r of spEntities ?? []) {
    const set = servedByProvider.get(r.provider_id) ?? new Set<string>();
    set.add(r.entity_id);
    servedByProvider.set(r.provider_id, set);
  }
  const routeToByType = new Map<string, Set<string>>();
  for (const t of typeRows ?? []) routeToByType.set(t.slug, new Set((t.route_to_disciplines as string[]) ?? []));
  const learnedByKey = new Map<string, { confirmed: number; dismissed: number }>();
  for (const r of rules ?? []) {
    learnedByKey.set(`${r.document_type}:${r.provider_id}`, { confirmed: r.times_confirmed, dismissed: r.times_dismissed });
  }

  // provider_id → { documents, learned }
  const grouped = new Map<string, { docs: OrgSendSuggestion["documents"]; learned: boolean }>();

  for (const doc of docs) {
    const dtype = doc.document_type as string | null;
    // Proactive suggestions use ONLY explicit route-to-disciplines + learned
    // rules — NOT the keyword hints. Keywords conflate "relevant" with "who
    // produces it" (financials' keyword is bookkeeping, but the bookkeeper
    // produced them and shouldn't receive them back). So financials, whose
    // route_to is empty, correctly produce no proactive suggestion until a send
    // teaches a rule. The manual send card stays liberal (keyword-aware).
    const seedTargets = dtype ? routeToByType.get(dtype) ?? new Set<string>() : new Set<string>();

    for (const p of providers) {
      if (doc.source_provider_id && p.id === doc.source_provider_id) continue; // veto
      const serves = p.serves_all_entities || (servedByProvider.get(p.id)?.has(doc.entity_id) ?? false);
      if (!serves) continue;

      const pair = `${doc.id}:${p.id}`;
      if (sentPairs.has(pair) || dismissedPairs.has(pair)) continue;

      const rule = dtype ? learnedByKey.get(`${dtype}:${p.id}`) : undefined;
      const learned = !!rule && rule.confirmed > rule.dismissed;
      const disciplines: string[] = p.disciplines ?? [];
      const disciplineMatch = disciplines.some((d) => seedTargets.has(d));
      if (!learned && !disciplineMatch) continue;

      const g = grouped.get(p.id) ?? { docs: [], learned: false };
      g.docs.push({ id: doc.id, name: doc.name, document_type: dtype });
      g.learned = g.learned || learned;
      grouped.set(p.id, g);
    }
  }

  const out: OrgSendSuggestion[] = [];
  for (const p of providers) {
    const g = grouped.get(p.id);
    if (!g || g.docs.length === 0) continue;
    out.push({
      provider: { id: p.id, name: p.name, disciplines: p.disciplines ?? [] },
      recommended_recipient_email: recommendRecipient({
        default_contact_email: p.default_contact_email,
        contacts: (p.contacts as ProviderContact[]) ?? [],
      }),
      documents: g.docs,
      learned: g.learned,
    });
  }

  // Learned suggestions first, then by bundle size.
  out.sort((a, b) => Number(b.learned) - Number(a.learned) || b.documents.length - a.documents.length || a.provider.name.localeCompare(b.provider.name));
  return out;
}

async function loadSentPairs(supabase: SupabaseClient, orgId: string): Promise<Set<string>> {
  // (document_id:provider_id) already sent (any non-failed send).
  const { data: sends } = await supabase
    .from("provider_document_sends")
    .select("id, provider_id, status")
    .eq("organization_id", orgId)
    .neq("status", "failed");
  const provBySend = new Map((sends ?? []).map((s) => [s.id, s.provider_id as string]));
  if (provBySend.size === 0) return new Set();
  const { data: bundle } = await supabase
    .from("provider_document_send_documents")
    .select("send_id, document_id")
    .eq("organization_id", orgId)
    .in("send_id", [...provBySend.keys()]);
  const set = new Set<string>();
  for (const b of bundle ?? []) {
    const prov = provBySend.get(b.send_id);
    if (prov) set.add(`${b.document_id}:${prov}`);
  }
  return set;
}

async function loadDismissedPairs(supabase: SupabaseClient, orgId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("provider_send_dismissals")
    .select("document_id, provider_id")
    .eq("organization_id", orgId);
  return new Set((data ?? []).map((d) => `${d.document_id}:${d.provider_id}`));
}

/**
 * Provenance inference: given a sender email/domain, find the provider whose
 * registered `domains` match — so an inbound document can be stamped with
 * `source_provider_id` (which then vetoes routing it back). Returns the
 * provider id or null. Phase 2 retrieval and any sender-aware ingestion path
 * call this; manual uploads (no sender) simply leave source null.
 */
export async function inferProviderFromSender(
  supabase: SupabaseClient,
  orgId: string,
  sender: string | null | undefined,
): Promise<string | null> {
  if (!sender) return null;
  const domain = sender.includes("@") ? sender.split("@").pop()! : sender;
  const normalized = domain.trim().toLowerCase();
  if (!normalized) return null;

  const { data } = await supabase
    .from("service_providers")
    .select("id")
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .contains("domains", [normalized])
    .maybeSingle();
  return data?.id ?? null;
}

export async function getRoutingSuggestions(
  supabase: SupabaseClient,
  orgId: string,
  documentId: string,
): Promise<RoutingSuggestion[]> {
  // 1. Document: entity, type, provenance.
  const { data: doc } = await supabase
    .from("documents")
    .select("id, entity_id, document_type, source_provider_id")
    .eq("id", documentId)
    .eq("organization_id", orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!doc || !doc.document_type) return [];

  // 2. Entity ids (direct + linked).
  const { data: links } = await supabase
    .from("document_entity_links")
    .select("entity_id")
    .eq("organization_id", orgId)
    .eq("document_id", documentId);
  const entityIds = new Set<string>();
  if (doc.entity_id) entityIds.add(doc.entity_id);
  for (const l of links ?? []) if (l.entity_id) entityIds.add(l.entity_id);

  // 3. Seeded routing intent for this type + learned rules + serving providers.
  const [{ data: typeRow }, { data: rules }, { data: providers }, { data: spEntities }] =
    await Promise.all([
      supabase.from("document_types").select("route_to_disciplines").eq("slug", doc.document_type).maybeSingle(),
      supabase
        .from("org_provider_routing_rules")
        .select("provider_id, times_confirmed, times_dismissed, confidence")
        .eq("organization_id", orgId)
        .eq("document_type", doc.document_type)
        .eq("is_active", true),
      supabase
        .from("service_providers")
        .select("id, name, disciplines, default_contact_email, contacts, serves_all_entities")
        .eq("organization_id", orgId)
        .is("deleted_at", null),
      supabase
        .from("service_provider_entities")
        .select("provider_id, entity_id")
        .eq("organization_id", orgId),
    ]);
  if (!providers || providers.length === 0) return [];

  const seedDisciplines = new Set<string>((typeRow?.route_to_disciplines as string[]) ?? []);
  const keywordDisciplines = relevantDisciplines(doc.document_type);
  const ruleByProvider = new Map<string, { times_confirmed: number; times_dismissed: number; confidence: number }>();
  for (const r of rules ?? []) ruleByProvider.set(r.provider_id, r);

  const servedByProvider = new Map<string, string[]>();
  for (const row of spEntities ?? []) {
    const arr = servedByProvider.get(row.provider_id) ?? [];
    arr.push(row.entity_id);
    servedByProvider.set(row.provider_id, arr);
  }

  const out: RoutingSuggestion[] = [];
  for (const p of providers) {
    // Provenance veto: never route a document back to where it came from.
    if (doc.source_provider_id && p.id === doc.source_provider_id) continue;

    // Must serve this entity (directly or via serves_all_entities).
    const served = servedByProvider.get(p.id) ?? [];
    const servesEntity = p.serves_all_entities || served.some((eid) => entityIds.has(eid));
    if (!servesEntity) continue;

    const disciplines: string[] = p.disciplines ?? [];
    const rule = ruleByProvider.get(p.id);
    const learned = !!rule && rule.times_confirmed > rule.times_dismissed;
    const disciplineMatch =
      disciplines.some((d) => seedDisciplines.has(d)) || disciplines.some((d) => keywordDisciplines.has(d));

    // Non-naggy: only suggest when there's an actual reason (learned or discipline-needs).
    if (!learned && !disciplineMatch) continue;

    const reason = learned
      ? `You've sent ${doc.document_type} to ${p.name} before`
      : `${p.name}${disciplines.length ? ` (${disciplines.join(", ")})` : ""} typically receives ${doc.document_type}`;

    const score = (learned ? 100 + (rule?.times_confirmed ?? 0) : 0) + (disciplineMatch ? 10 : 0);

    out.push({
      provider: { id: p.id, name: p.name, disciplines, serves_all_entities: p.serves_all_entities },
      recommended_recipient_email: recommendRecipient({
        default_contact_email: p.default_contact_email,
        contacts: (p.contacts as ProviderContact[]) ?? [],
      }),
      reason,
      learned,
      score,
    });
  }

  out.sort((a, b) => b.score - a.score || a.provider.name.localeCompare(b.provider.name));
  return out;
}

/**
 * Learning hook: record that the user routed `documentType` to `providerId` in
 * this org. Increments times_confirmed and recomputes confidence. Called on
 * every send (the routing decision is the signal, independent of whether the
 * delivery itself succeeded). Best-effort — never throws into the send path.
 */
export async function recordRoutingDecision(
  admin: SupabaseClient,
  orgId: string,
  documentType: string | null,
  providerId: string,
): Promise<void> {
  if (!documentType) return;
  try {
    const { data: existing } = await admin
      .from("org_provider_routing_rules")
      .select("id, times_confirmed, times_dismissed")
      .eq("organization_id", orgId)
      .eq("document_type", documentType)
      .eq("provider_id", providerId)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    if (existing) {
      const confirmed = (existing.times_confirmed ?? 0) + 1;
      const dismissed = existing.times_dismissed ?? 0;
      await admin
        .from("org_provider_routing_rules")
        .update({
          times_confirmed: confirmed,
          confidence: confirmed / (confirmed + dismissed),
          last_sent_at: nowIso,
          is_active: true,
          updated_at: nowIso,
        })
        .eq("id", existing.id);
    } else {
      await admin.from("org_provider_routing_rules").insert({
        organization_id: orgId,
        document_type: documentType,
        provider_id: providerId,
        times_confirmed: 1,
        times_dismissed: 0,
        confidence: 1,
        last_sent_at: nowIso,
      });
    }
  } catch (err) {
    console.error("[routing] recordRoutingDecision failed:", err);
  }
}
