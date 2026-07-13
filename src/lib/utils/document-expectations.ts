/**
 * Document Completeness Tracking utilities.
 *
 * Handles:
 * - Generating system expectations per entity based on type/structure/registrations
 * - Applying org-wide templates to matching entities
 * - Checking/satisfying expectations when documents are uploaded
 * - Rechecking when documents are deleted or reassigned
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ALL_SYSTEM_DEFAULTS,
  mapToDocumentScope,
} from "@/lib/data/document-defaults";
import { documentTypeSatisfies } from "@/lib/data/document-type-aliases";

// Re-export so existing importers don't need to change.
export {
  ALL_SYSTEM_DEFAULTS,
  DOCUMENT_SCOPES,
  mapToDocumentScope,
  getSystemDefaultsForScope,
} from "@/lib/data/document-defaults";
export type { SystemDefault, DocumentScope } from "@/lib/data/document-defaults";

// --- Types ---

export interface ExpectedDocument {
  document_type: string;
  document_category: string;
  is_required: boolean;
  source: "system" | "template" | "manual" | "inferred";
  template_id?: string;
  notes?: string;
}

interface EntityInfo {
  id: string;
  type: string;
  legal_structure: string | null;
  organization_id: string;
}

interface TemplateFilter {
  entity_type?: string[];
  legal_structure?: string[];
  state?: string[];
}

/**
 * Org-level override for a system default.
 */
export interface SystemDefaultOverride {
  document_type: string;
  is_disabled: boolean;
  is_required: boolean;
}

/**
 * Base expectations that apply to ALL entity types.
 */
const BASE_EXPECTATIONS: ExpectedDocument[] = [
  { document_type: "operating_agreement", document_category: "formation", is_required: true, source: "system" },
  { document_type: "certificate_of_formation", document_category: "formation", is_required: true, source: "system" },
  { document_type: "ein_letter", document_category: "tax", is_required: true, source: "system" },
  { document_type: "registered_agent_appointment", document_category: "compliance", is_required: true, source: "system" },
];

/**
 * Additional expectations by entity type.
 */
const TYPE_EXPECTATIONS: Record<string, ExpectedDocument[]> = {
  trust: [
    { document_type: "trust_agreement", document_category: "formation", is_required: true, source: "system" },
  ],
  investment_fund: [
    { document_type: "ppm", document_category: "investor", is_required: false, source: "system", notes: "Private Placement Memorandum or offering documents" },
    { document_type: "subscription_agreement", document_category: "investor", is_required: false, source: "system" },
  ],
  real_estate: [
    { document_type: "certificate_of_insurance", document_category: "insurance", is_required: false, source: "system", notes: "Property insurance certificate" },
    { document_type: "lease_agreement", document_category: "contracts", is_required: false, source: "system", notes: "If rental property" },
  ],
};

/**
 * Expectations by legal structure (overrides or supplements type-based).
 */
const STRUCTURE_EXPECTATIONS: Record<string, ExpectedDocument[]> = {
  corporation: [
    { document_type: "articles_of_incorporation", document_category: "formation", is_required: true, source: "system" },
    { document_type: "bylaws", document_category: "governance", is_required: true, source: "system" },
  ],
  lp: [
    { document_type: "partnership_agreement", document_category: "formation", is_required: true, source: "system" },
  ],
  grantor_trust: [
    { document_type: "trust_agreement", document_category: "formation", is_required: true, source: "system" },
  ],
  non_grantor_trust: [
    { document_type: "trust_agreement", document_category: "formation", is_required: true, source: "system" },
    { document_type: "ein_letter", document_category: "tax", is_required: true, source: "system" },
  ],
};

// --- Core Functions ---

/**
 * @deprecated Legacy system-default generator. Superseded by the three-tier
 * profiles + overrides model read directly from document_profiles /
 * org_document_overrides by refreshEntityExpectations. No production caller
 * remains as of PR 4.3. Kept for the deprecation window alongside
 * /api/document-templates.
 *
 * Generate system expectations for an entity based on its type, structure, and registrations.
 * Does NOT insert — returns the list for the caller to upsert.
 */
export function generateSystemExpectations(
  entityType: string,
  legalStructure: string | null,
  overrides?: SystemDefaultOverride[],
): ExpectedDocument[] {
  const overrideMap = new Map(
    (overrides || []).map((o) => [o.document_type, o])
  );

  // Grantor trusts are pass-through: they don't need their own EIN, operating agreement,
  // certificate of formation, or registered agent. Only trust agreement.
  // Non-grantor trusts are separate tax entities: they need their own EIN + trust agreement
  // but not operating agreement / cert of formation.
  const isTrustStructure = legalStructure === "grantor_trust" || legalStructure === "non_grantor_trust" || legalStructure === "trust";

  let expectations: ExpectedDocument[];

  if (isTrustStructure || entityType === "trust") {
    // Trusts don't use base expectations — build from scratch via structure
    expectations = [];
  } else {
    expectations = [...BASE_EXPECTATIONS];

    // Corporation: replace operating_agreement with articles + bylaws
    if (legalStructure === "corporation") {
      const idx = expectations.findIndex((e) => e.document_type === "operating_agreement");
      if (idx !== -1) expectations.splice(idx, 1);
    }

    // LP: replace operating_agreement with partnership_agreement
    if (legalStructure === "lp") {
      const idx = expectations.findIndex((e) => e.document_type === "operating_agreement");
      if (idx !== -1) expectations.splice(idx, 1);
    }
  }

  // Add type-specific
  const typeExtras = TYPE_EXPECTATIONS[entityType];
  if (typeExtras) expectations.push(...typeExtras);

  // Add structure-specific
  const structExtras = STRUCTURE_EXPECTATIONS[legalStructure || ""];
  if (structExtras) expectations.push(...structExtras);

  // Apply org overrides: disable items or change required status
  const filtered = expectations.filter((e) => {
    const override = overrideMap.get(e.document_type);
    if (override?.is_disabled) return false;
    if (override) e.is_required = override.is_required;
    return true;
  });

  // Deduplicate by document_type
  const seen = new Set<string>();
  return filtered.filter((e) => {
    if (seen.has(e.document_type)) return false;
    seen.add(e.document_type);
    return true;
  });
}

/**
 * @deprecated applies_to_filter is a concept from the legacy
 * document_expectation_templates model. The three-tier model replaces it
 * with document_profiles.entity_type_scope, which is a scalar per row — no
 * filter matching needed at engine time. This helper only remains for the
 * legacy /api/document-templates route + applyTemplate during the
 * deprecation window.
 *
 * Check if an entity matches a template's applies_to_filter.
 */
export function matchesFilter(
  entity: EntityInfo,
  filter: TemplateFilter,
  registrationStates?: string[]
): boolean {
  if (!filter || Object.keys(filter).length === 0) return true; // empty = all

  if (filter.entity_type && filter.entity_type.length > 0) {
    if (!filter.entity_type.includes(entity.type)) return false;
  }
  if (filter.legal_structure && filter.legal_structure.length > 0) {
    if (!entity.legal_structure || !filter.legal_structure.includes(entity.legal_structure)) return false;
  }
  if (filter.state && filter.state.length > 0) {
    if (!registrationStates || !filter.state.some((s) => registrationStates.includes(s))) return false;
  }
  return true;
}

/**
 * Populate expectations for a single entity from the three-tier model:
 *   Tier 1: org_document_overrides (action='disable' kills a doc_type org-wide)
 *   Tier 2: document_profiles (per scope, with enabled + is_required + category)
 *   Tier 3: entity_document_expectations.is_not_applicable (per-entity dismiss)
 *
 * Entities whose legal_structure doesn't map to one of the four document scopes
 * (llc/corporation/lp/trust) get no system-generated expectations — manual and
 * inferred items are preserved untouched.
 */
export async function refreshEntityExpectations(entityId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: entity } = await admin
    .from("entities")
    .select("id, type, status, legal_structure, organization_id")
    .eq("id", entityId)
    .single();
  if (!entity) return;

  if (entity.status && entity.status !== "active") return;

  const orgId = entity.organization_id as string;
  const scope = mapToDocumentScope(entity.legal_structure);

  // Fetch org overrides + scoped profiles in parallel.
  const [overridesResult, profilesResult] = await Promise.all([
    admin
      .from("org_document_overrides")
      .select("document_type, action")
      .eq("organization_id", orgId),
    scope
      ? admin
          .from("document_profiles")
          .select("document_type, document_category, is_required, enabled, notes")
          .eq("organization_id", orgId)
          .eq("entity_type_scope", scope)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
  ]);

  const disabledDocTypes = new Set(
    (overridesResult.data || [])
      .filter((o: Record<string, unknown>) => o.action === "disable")
      .map((o: Record<string, unknown>) => o.document_type as string)
  );

  const expected: ExpectedDocument[] = (profilesResult.data || [])
    .filter((p: Record<string, unknown>) => p.enabled !== false)
    .filter((p: Record<string, unknown>) => !disabledDocTypes.has(p.document_type as string))
    .map((p: Record<string, unknown>) => ({
      document_type: p.document_type as string,
      document_category: (p.document_category as string) || "other",
      is_required: p.is_required as boolean,
      source: "system" as const,
      notes: (p.notes as string) || undefined,
    }));

  // Fetch existing expectations to preserve user state.
  const { data: existing } = await admin
    .from("entity_document_expectations")
    .select("document_type, is_not_applicable, is_satisfied, satisfied_by, source, notes")
    .eq("entity_id", entityId);
  const existingMap = new Map(
    (existing || []).map((e: Record<string, unknown>) => [e.document_type as string, e])
  );

  // Upsert expected rows. Skip any document_type the user has dismissed or
  // tracks as a manual item — those stay as-is.
  const rows = expected
    .filter((exp) => {
      const prev = existingMap.get(exp.document_type);
      return !(prev && (prev.is_not_applicable || prev.source === "manual"));
    })
    .map((exp) => {
      const prev = existingMap.get(exp.document_type);
      return {
        entity_id: entityId,
        organization_id: orgId,
        template_id: null,
        document_type: exp.document_type,
        document_category: exp.document_category,
        is_required: exp.is_required,
        source: exp.source,
        notes: exp.notes || (prev?.notes as string) || null,
        is_satisfied: (prev?.is_satisfied as boolean) ?? false,
        satisfied_by: (prev?.satisfied_by as string) ?? null,
      };
    });

  if (rows.length > 0) {
    const { error: upsertError } = await admin
      .from("entity_document_expectations")
      .upsert(rows, { onConflict: "entity_id,document_type" });
    if (upsertError) {
      console.error("Expectations upsert error:", upsertError.message, { entityId, rowCount: rows.length });
    }
  }

  // Remove stale system/template rows that aren't in the new expected set.
  // Preserves manual, inferred, and user-dismissed rows. The 'template' source
  // exists in legacy data from before this engine rewrite — we still clean
  // those up so a re-sync removes obsolete items the old system created.
  const validDocTypes = new Set(expected.map((e) => e.document_type));
  const staleRows = (existing || []).filter((e: Record<string, unknown>) => {
    const source = e.source as string;
    if (source !== "system" && source !== "template") return false;
    if (e.is_not_applicable) return false;
    return !validDocTypes.has(e.document_type as string);
  });

  if (staleRows.length > 0) {
    const staleTypes = staleRows.map((r: Record<string, unknown>) => r.document_type as string);
    await admin
      .from("entity_document_expectations")
      .delete()
      .eq("entity_id", entityId)
      .in("document_type", staleTypes)
      .in("source", ["system", "template"]);
  }
}

/**
 * @deprecated Writes + reads document_expectation_templates, which the new
 * engine ignores. Callers remaining as of PR 4.5: the legacy
 * /api/document-templates route and the inference engine's "promote pattern
 * to template" action. Both paths produce rows the engine no longer acts on;
 * the inference-side promotion will be rewired to write to document_profiles
 * when the inference engine activation PR (original spec's PR 6) lands.
 *
 * Apply a template to all matching entities in the org.
 */
export async function applyTemplate(templateId: string): Promise<number> {
  const admin = createAdminClient();

  const { data: template } = await admin
    .from("document_expectation_templates")
    .select("*")
    .eq("id", templateId)
    .single();
  if (!template) return 0;

  // Fetch all entities in the org
  const { data: entities } = await admin
    .from("entities")
    .select("id, type, legal_structure, organization_id")
    .eq("organization_id", template.organization_id)
    .neq("status", "deleted");

  // Check if this template's doc type is in system defaults with restricted applies_to
  const systemDefault = ALL_SYSTEM_DEFAULTS.find((sd) => sd.document_type === template.document_type);
  const filter: TemplateFilter = template.applies_to_filter || {};
  const hasExplicitStructureFilter = filter.legal_structure && filter.legal_structure.length > 0;

  let applied = 0;
  for (const entity of entities || []) {
    // Fetch registrations for state filter
    const { data: regs } = await admin
      .from("entity_registrations")
      .select("jurisdiction")
      .eq("entity_id", entity.id);
    const regStates = (regs || []).map((r: { jurisdiction: string }) => r.jurisdiction);

    if (!matchesFilter(entity as EntityInfo, filter, regStates)) continue;

    // If template has no explicit legal_structure filter and system default restricts this
    // doc type to specific structures, skip entities that don't match those structures.
    if (!hasExplicitStructureFilter && systemDefault && systemDefault.applies_to.length > 0) {
      const structureMatch = entity.legal_structure && systemDefault.applies_to.includes(entity.legal_structure);
      const typeMatch = systemDefault.applies_to.includes(entity.type);
      if (!structureMatch && !typeMatch) continue;
    }

    // Check if expectation already exists for this entity
    const { data: existing } = await admin
      .from("entity_document_expectations")
      .select("id, is_not_applicable")
      .eq("entity_id", entity.id)
      .eq("document_type", template.document_type)
      .maybeSingle();

    // Skip if user already dismissed this for the entity
    if (existing?.is_not_applicable) continue;

    await admin
      .from("entity_document_expectations")
      .upsert(
        {
          entity_id: entity.id,
          organization_id: template.organization_id,
          template_id: template.id,
          document_type: template.document_type,
          document_category: template.document_category,
          is_required: template.is_required,
          source: "template",
          notes: template.description,
        },
        { onConflict: "entity_id,document_type" }
      );
    applied++;
  }

  return applied;
}

// --- Satisfaction Logic ---

/**
 * After a document is created/ingested, check if it satisfies any expectations
 * for its primary entity AND any linked entities (via document_entity_links).
 */
export async function checkAndSatisfyExpectations(documentId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("documents")
    .select("id, entity_id, document_type, document_category, deleted_at")
    .eq("id", documentId)
    .single();

  if (!doc || doc.deleted_at) return;

  // Collect all entity IDs to check: primary + linked
  const entityIds = new Set<string>();
  if (doc.entity_id) entityIds.add(doc.entity_id);

  const { data: links } = await admin
    .from("document_entity_links")
    .select("entity_id")
    .eq("document_id", documentId);

  for (const link of links || []) {
    if (link.entity_id) entityIds.add(link.entity_id);
  }

  if (entityIds.size === 0) return;

  // Find unsatisfied expectations for ALL linked entities
  const { data: expectations } = await admin
    .from("entity_document_expectations")
    .select("id, entity_id, document_type, document_category")
    .in("entity_id", Array.from(entityIds))
    .eq("is_satisfied", false)
    .eq("is_not_applicable", false);

  // Track which entity has already had a type match (one satisfaction per entity)
  const satisfiedByType = new Set<string>();

  for (const exp of expectations || []) {
    const typeMatch = documentTypeSatisfies(exp.document_type, doc.document_type);
    // Category-only match: only for generic expectations (document_type "other" or empty),
    // NOT when the expectation has a specific document_type like "federal_tax_return"
    const isGenericExpectation = !exp.document_type || exp.document_type === "other";
    const categoryMatch = isGenericExpectation && exp.document_category === doc.document_category && !typeMatch;

    if (typeMatch || categoryMatch) {
      // Skip if we already satisfied a type-match for this entity
      if (satisfiedByType.has(exp.entity_id)) continue;

      await admin
        .from("entity_document_expectations")
        .update({
          is_satisfied: true,
          satisfied_by: doc.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", exp.id);

      if (typeMatch) satisfiedByType.add(exp.entity_id);
    }
  }
}

/**
 * When a document is deleted, un-satisfy any expectation it was satisfying.
 */
export async function unsatisfyByDocument(documentId: string): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("entity_document_expectations")
    .update({
      is_satisfied: false,
      satisfied_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("satisfied_by", documentId);
}

/**
 * Recheck all expectations for an entity by scanning its current documents
 * (both directly assigned and linked via document_entity_links).
 */
export async function recheckEntityExpectations(entityId: string): Promise<void> {
  const admin = createAdminClient();

  // Reset all expectations for this entity
  await admin
    .from("entity_document_expectations")
    .update({
      is_satisfied: false,
      satisfied_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("entity_id", entityId)
    .eq("is_not_applicable", false);

  // Fetch direct documents
  const { data: directDocs } = await admin
    .from("documents")
    .select("id, document_type, document_category")
    .eq("entity_id", entityId)
    .is("deleted_at", null);

  // Fetch linked documents via document_entity_links
  const { data: links } = await admin
    .from("document_entity_links")
    .select("document_id")
    .eq("entity_id", entityId);

  const directIds = new Set((directDocs || []).map((d) => d.id));
  const linkedDocIds = (links || [])
    .map((l) => l.document_id)
    .filter((id) => !directIds.has(id));

  let linkedDocs: typeof directDocs = [];
  if (linkedDocIds.length > 0) {
    const { data: ld } = await admin
      .from("documents")
      .select("id, document_type, document_category")
      .in("id", linkedDocIds)
      .is("deleted_at", null);
    linkedDocs = ld || [];
  }

  // Check all documents (direct + linked) against expectations
  const allDocs = [...(directDocs || []), ...(linkedDocs || [])];
  for (const doc of allDocs) {
    // Inline satisfaction check (checkAndSatisfyExpectations queries links again,
    // but for recheck that's fine since it's a one-time operation)
    await checkAndSatisfyExpectations(doc.id);
  }
}

/**
 * Get completeness summary for an entity — used in chat context and UI.
 */
export async function getEntityCompleteness(entityId: string): Promise<{
  total: number;
  satisfied: number;
  missing: Array<{ document_type: string; document_category: string; is_required: boolean }>;
}> {
  const admin = createAdminClient();

  const { data: expectations } = await admin
    .from("entity_document_expectations")
    .select("document_type, document_category, is_required, is_satisfied, is_not_applicable, is_suggestion")
    .eq("entity_id", entityId)
    .eq("is_not_applicable", false)
    .eq("is_suggestion", false);

  const items = expectations || [];
  const total = items.length;
  const satisfied = items.filter((e: Record<string, unknown>) => e.is_satisfied).length;
  const missing = items
    .filter((e: Record<string, unknown>) => !e.is_satisfied)
    .map((e: Record<string, unknown>) => ({
      document_type: e.document_type as string,
      document_category: e.document_category as string,
      is_required: e.is_required as boolean,
    }));

  return { total, satisfied, missing };
}
