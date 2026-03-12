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

// --- System Default Expectations ---

export interface SystemDefault {
  document_type: string;
  document_category: string;
  is_required: boolean;
  applies_to: string[]; // list of entity types or legal structures this applies to (empty = all non-trust)
  notes?: string;
}

/**
 * Full list of all system defaults (exported for settings UI).
 * Each document_type appears once with its list of applicable structures/types.
 */
export const ALL_SYSTEM_DEFAULTS: SystemDefault[] = [
  // Base — applies to LLC-family structures (not trusts, which have their own set)
  { document_type: "operating_agreement", document_category: "formation", is_required: true, applies_to: ["llc", "gp"] },
  { document_type: "certificate_of_formation", document_category: "formation", is_required: true, applies_to: ["llc", "corporation", "lp", "gp"] },
  { document_type: "ein_letter", document_category: "tax", is_required: true, applies_to: ["llc", "corporation", "lp", "gp", "non_grantor_trust"] },
  { document_type: "registered_agent_appointment", document_category: "compliance", is_required: true, applies_to: ["llc", "corporation", "lp", "gp"] },
  { document_type: "certificate_of_good_standing", document_category: "compliance", is_required: false, applies_to: ["llc", "corporation", "lp", "gp", "non_grantor_trust"] },
  { document_type: "federal_tax_return", document_category: "tax", is_required: false, applies_to: ["llc", "corporation", "lp", "gp", "non_grantor_trust"] },
  // Trust-specific
  { document_type: "trust_agreement", document_category: "formation", is_required: true, applies_to: ["grantor_trust", "non_grantor_trust"] },
  // Type-specific
  { document_type: "ppm", document_category: "investor", is_required: false, applies_to: ["investment_fund"], notes: "Private Placement Memorandum or offering documents" },
  { document_type: "subscription_agreement", document_category: "investor", is_required: false, applies_to: ["investment_fund"] },
  { document_type: "certificate_of_insurance", document_category: "insurance", is_required: false, applies_to: ["real_estate"], notes: "Property insurance certificate" },
  { document_type: "lease_agreement", document_category: "contracts", is_required: false, applies_to: ["real_estate"], notes: "If rental property" },
  // Structure-specific
  { document_type: "articles_of_incorporation", document_category: "formation", is_required: true, applies_to: ["corporation"] },
  { document_type: "bylaws", document_category: "governance", is_required: true, applies_to: ["corporation"] },
  { document_type: "partnership_agreement", document_category: "formation", is_required: true, applies_to: ["lp"] },
];

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
 * Populate expectations for a single entity — system defaults + matching templates.
 * Uses upsert to avoid duplicates. Skips expectations already marked is_not_applicable.
 */
export async function refreshEntityExpectations(entityId: string): Promise<void> {
  const admin = createAdminClient();

  // Fetch entity info
  const { data: entity } = await admin
    .from("entities")
    .select("id, type, legal_structure, organization_id")
    .eq("id", entityId)
    .single();
  if (!entity) return;

  // Fetch registration states for filter matching
  const { data: registrations } = await admin
    .from("entity_registrations")
    .select("jurisdiction")
    .eq("entity_id", entityId);
  const regStates = (registrations || []).map((r: { jurisdiction: string }) => r.jurisdiction);

  // 1. Fetch org templates (includes system overrides with source='system')
  const { data: templates } = await admin
    .from("document_expectation_templates")
    .select("*")
    .eq("organization_id", entity.organization_id);

  // Extract system default overrides
  const systemOverrides: SystemDefaultOverride[] = (templates || [])
    .filter((t: Record<string, unknown>) => t.source === "system")
    .map((t: Record<string, unknown>) => ({
      document_type: t.document_type as string,
      is_disabled: (t.applies_to_filter as Record<string, unknown>)?.disabled === true,
      is_required: t.is_required as boolean,
    }));

  // 2. Generate system defaults with org overrides applied
  const systemExpectations = generateSystemExpectations(entity.type, entity.legal_structure, systemOverrides);

  // Build a set of doc types that system defaults explicitly exclude for this entity.
  // If a system default has an applies_to list and this entity's structure/type isn't in it,
  // that doc type is "system-excluded" — templates without an explicit legal_structure filter
  // should not re-add it.
  const systemExcludedTypes = new Set<string>();
  for (const sd of ALL_SYSTEM_DEFAULTS) {
    if (sd.applies_to.length > 0) {
      const structureMatch = entity.legal_structure && sd.applies_to.includes(entity.legal_structure);
      const typeMatch = sd.applies_to.includes(entity.type);
      if (!structureMatch && !typeMatch) {
        systemExcludedTypes.add(sd.document_type);
      }
    }
  }

  // 3. Apply non-system templates
  const templateExpectations: ExpectedDocument[] = [];
  for (const tpl of templates || []) {
    if ((tpl.source as string) === "system") continue; // already handled via overrides
    const filter: TemplateFilter = tpl.applies_to_filter || {};
    if (!matchesFilter(entity as EntityInfo, filter, regStates)) continue;

    // If template has no legal_structure filter (i.e. "all entities") and the doc type
    // is system-excluded for this entity, skip it — don't re-add what the system removed.
    const hasExplicitStructureFilter = filter.legal_structure && filter.legal_structure.length > 0;
    if (!hasExplicitStructureFilter && systemExcludedTypes.has(tpl.document_type)) continue;

    templateExpectations.push({
      document_type: tpl.document_type,
      document_category: tpl.document_category,
      is_required: tpl.is_required,
      source: "template",
      template_id: tpl.id,
      notes: tpl.description,
    });
  }

  // 3. Merge (system first, template overrides)
  const allExpectations = [...systemExpectations, ...templateExpectations];
  const seen = new Set<string>();
  const deduped = allExpectations.filter((e) => {
    if (seen.has(e.document_type)) return false;
    seen.add(e.document_type);
    return true;
  });

  // 4. Fetch existing expectations to preserve user state (is_not_applicable, manual items, satisfaction)
  const { data: existing } = await admin
    .from("entity_document_expectations")
    .select("document_type, is_not_applicable, is_satisfied, satisfied_by, source, notes")
    .eq("entity_id", entityId);
  const existingMap = new Map(
    (existing || []).map((e: Record<string, unknown>) => [e.document_type as string, e])
  );

  // 5. Upsert expectations (bulk)
  const rows = deduped
    .filter((exp) => {
      const prev = existingMap.get(exp.document_type);
      // Don't overwrite user-dismissed items or manual items
      return !(prev && (prev.is_not_applicable || prev.source === "manual"));
    })
    .map((exp) => {
      const prev = existingMap.get(exp.document_type);
      return {
        entity_id: entityId,
        organization_id: entity.organization_id,
        template_id: exp.template_id || null,
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

  // Remove stale system/template expectations that no longer apply
  // (e.g., trust changed from non-grantor to grantor — remove EIN requirement)
  const validDocTypes = new Set(deduped.map((e) => e.document_type));
  const staleRows = (existing || []).filter((e: Record<string, unknown>) => {
    const source = e.source as string;
    const docType = e.document_type as string;
    // Only remove system/template items that aren't in the new set
    // Preserve manual, inferred, and user-dismissed items
    if (source !== "system" && source !== "template") return false;
    if (e.is_not_applicable) return false;
    return !validDocTypes.has(docType);
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
    const typeMatch = exp.document_type === doc.document_type;
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
