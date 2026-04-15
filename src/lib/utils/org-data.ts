/**
 * Shared org data fetcher — single source of truth for all org context.
 * Used by: buildChatContext, getDbContext (extract.ts), fetchEntityContext (extract-v2.ts),
 * triage rosters (triage.ts).
 *
 * When a new table is added to the data model, add it here once.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { Redis } from "@upstash/redis";

// --- Cache ---

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redis;
}

// --- Types ---

export interface OrgContextOptions {
  entities?: boolean;       // default true
  directory?: boolean;      // default true
  relationships?: boolean;  // default true
  compliance?: boolean;     // default true
  investments?: boolean;    // default true
  documents?: boolean;      // default false (large)
  patterns?: boolean;       // default false
  suggestions?: boolean;    // default false
  signals?: boolean;        // default false

  // Scoping
  entityId?: string;        // If set, fetch full data for this entity + slim roster for others
  investmentId?: string;    // If set, include investment detail

}

export interface OrgContext {
  entities: Array<Record<string, unknown>>;
  directory: Array<Record<string, unknown>>;
  relationships: Array<Record<string, unknown>>;
  registrations: Array<Record<string, unknown>>;
  managers: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  trustDetails: Array<Record<string, unknown>>;
  trustRoles: Array<Record<string, unknown>>;
  capTable: Array<Record<string, unknown>>;
  partnershipReps: Array<Record<string, unknown>>;
  entityRoles: Array<Record<string, unknown>>;
  compliance: Array<Record<string, unknown>>;
  investments: Array<Record<string, unknown>>;
  investmentInvestors: Array<Record<string, unknown>>;
  investmentAllocations: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  patterns: Array<Record<string, unknown>>;
  suggestions: Array<Record<string, unknown>>;
  signals: Array<Record<string, unknown>>;
  expectations: Array<Record<string, unknown>>;

  // Derived lookups
  entityById: Map<string, Record<string, unknown>>;
  entityByName: Map<string, Record<string, unknown>>;
  investmentById: Map<string, Record<string, unknown>>;
}

// --- Fetcher ---

export async function fetchOrgContext(
  orgId: string,
  options: OrgContextOptions = {}
): Promise<OrgContext> {
  const {
    entities: fetchEntities = true,
    directory: fetchDirectory = true,
    relationships: fetchRelationships = true,
    compliance: fetchCompliance = true,
    investments: fetchInvestments = true,
    documents: fetchDocuments = false,
    patterns: fetchPatterns = false,
    suggestions: fetchSuggestions = false,
    signals: fetchSignals = false,
    entityId,
    investmentId,
  } = options;

  const admin = createAdminClient();

  // Phase 1: Entities (needed for scoping sub-table fetches)
  let entities: Array<Record<string, unknown>> = [];
  if (fetchEntities) {
    const { data } = await admin.from("entities")
      .select("*")
      .eq("organization_id", orgId)
      .order("name");
    entities = data || [];
  }
  const entityIds = entities.map((e) => e.id as string);

  // Phase 2: All sub-tables in parallel
  const [
    directoryRes,
    relationshipsRes,
    registrationsRes,
    managersRes,
    membersRes,
    trustDetailsRes,
    capTableRes,
    partnershipRepsRes,
    entityRolesRes,
    complianceRes,
    investmentsRes,
  ] = await Promise.all([
    fetchDirectory
      ? admin.from("directory_entries").select("*").eq("organization_id", orgId).order("name")
      : Promise.resolve({ data: [] }),
    fetchRelationships
      ? admin.from("relationships").select("*").eq("organization_id", orgId)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? admin.from("entity_registrations").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? admin.from("entity_managers").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? admin.from("entity_members").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? admin.from("trust_details").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? admin.from("cap_table_entries").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? admin.from("entity_partnership_reps").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    entityIds.length > 0
      ? admin.from("entity_roles").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [] }),
    fetchCompliance && entityIds.length > 0
      ? admin.from("compliance_obligations").select("*").in("entity_id", entityIds).order("next_due_date", { ascending: true })
      : Promise.resolve({ data: [] }),
    fetchInvestments
      ? admin.from("investments").select("*").eq("organization_id", orgId).order("name")
      : Promise.resolve({ data: [] }),
  ]);

  const trustDetails = trustDetailsRes.data || [];
  const trustDetailIds = trustDetails.map((t: Record<string, unknown>) => t.id as string);
  const trustRolesRes = trustDetailIds.length > 0
    ? await admin.from("trust_roles").select("*").in("trust_detail_id", trustDetailIds)
    : { data: [] };

  // Investment sub-tables
  const investmentsList = investmentsRes.data || [];
  const investmentIds = investmentsList.map((i: Record<string, unknown>) => i.id as string);

  const [investmentInvestorsRes, investmentAllocationsRes] = await Promise.all([
    investmentIds.length > 0
      ? admin.from("investment_investors").select("*, entities:entity_id(name, short_name)")
          .in("investment_id", investmentIds).eq("is_active", true)
      : Promise.resolve({ data: [] }),
    investmentIds.length > 0
      ? admin.from("investment_allocations")
          .select("*")
          .in("investment_id", investmentIds) // legacy field, may be null for new records
          .eq("is_active", true)
      : Promise.resolve({ data: [] }),
  ]);

  // Documents (optional, large)
  let documents: Array<Record<string, unknown>> = [];
  if (fetchDocuments) {
    const { data } = await admin.from("documents")
      .select("id, name, document_type, document_category, year, entity_id, investment_id, ai_extracted, ai_extraction, created_at")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    documents = data || [];
  }

  // Patterns, suggestions, signals (optional)
  let patterns: Array<Record<string, unknown>> = [];
  let suggestions: Array<Record<string, unknown>> = [];
  let signals: Array<Record<string, unknown>> = [];
  let expectations: Array<Record<string, unknown>> = [];

  if (fetchPatterns || fetchSuggestions || fetchSignals) {
    const [pRes, sRes, sigRes, expRes] = await Promise.all([
      fetchPatterns
        ? admin.from("org_document_patterns").select("*").eq("organization_id", orgId).eq("is_active", true)
        : Promise.resolve({ data: [] }),
      fetchSuggestions && entityIds.length > 0
        ? admin.from("entity_document_expectations").select("*").in("entity_id", entityIds).eq("is_suggestion", true).eq("is_not_applicable", false)
        : Promise.resolve({ data: [] }),
      fetchSignals && entityIds.length > 0
        ? admin.from("entity_recurrence_signals").select("*").in("entity_id", entityIds).eq("is_active", true)
        : Promise.resolve({ data: [] }),
      entityIds.length > 0
        ? admin.from("entity_document_expectations").select("entity_id, document_type, is_satisfied, is_not_applicable, is_suggestion, is_required").in("entity_id", entityIds).eq("is_not_applicable", false).eq("is_suggestion", false)
        : Promise.resolve({ data: [] }),
    ]);
    patterns = pRes.data || [];
    suggestions = sRes.data || [];
    signals = sigRes.data || [];
    expectations = expRes.data || [];
  }

  const result: OrgContext = {
    entities,
    directory: directoryRes.data || [],
    relationships: relationshipsRes.data || [],
    registrations: registrationsRes.data || [],
    managers: managersRes.data || [],
    members: membersRes.data || [],
    trustDetails,
    trustRoles: trustRolesRes.data || [],
    capTable: capTableRes.data || [],
    partnershipReps: partnershipRepsRes.data || [],
    entityRoles: entityRolesRes.data || [],
    compliance: complianceRes.data || [],
    investments: investmentsList,
    investmentInvestors: investmentInvestorsRes.data || [],
    investmentAllocations: investmentAllocationsRes.data || [],
    documents,
    patterns,
    suggestions,
    signals,
    expectations,
    entityById: new Map(entities.map((e) => [e.id as string, e])),
    entityByName: new Map(entities.map((e) => [e.name as string, e])),
    investmentById: new Map(investmentsList.map((i) => [i.id as string, i])),
  };

  return result;
}

/**
 * Invalidate all cached org contexts for an org.
 * Called on every data mutation via logAuditEvent.
 */
export async function invalidateAllOrgCaches(orgId: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await Promise.all([
      client.del(`chat-ctx:${orgId}`),
      client.del(`extraction-ctx:${orgId}`),
    ]);
  } catch (err) {
    console.error("[CACHE] Invalidation error:", err);
  }
}
