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
};

// --- Core Functions ---

/**
 * Generate system expectations for an entity based on its type, structure, and registrations.
 * Does NOT insert — returns the list for the caller to upsert.
 */
export function generateSystemExpectations(
  entityType: string,
  legalStructure: string | null,
): ExpectedDocument[] {
  const expectations = [...BASE_EXPECTATIONS];

  // Trust entities: replace operating_agreement with trust_agreement
  if (entityType === "trust") {
    const idx = expectations.findIndex((e) => e.document_type === "operating_agreement");
    if (idx !== -1) expectations.splice(idx, 1);
  }

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

  // Add type-specific
  const typeExtras = TYPE_EXPECTATIONS[entityType];
  if (typeExtras) expectations.push(...typeExtras);

  // Add structure-specific
  const structExtras = STRUCTURE_EXPECTATIONS[legalStructure || ""];
  if (structExtras) expectations.push(...structExtras);

  // Deduplicate by document_type
  const seen = new Set<string>();
  return expectations.filter((e) => {
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

  // 1. Generate system defaults
  const systemExpectations = generateSystemExpectations(entity.type, entity.legal_structure);

  // 2. Fetch org templates
  const { data: templates } = await admin
    .from("document_expectation_templates")
    .select("*")
    .eq("organization_id", entity.organization_id);

  const templateExpectations: ExpectedDocument[] = [];
  for (const tpl of templates || []) {
    if (matchesFilter(entity as EntityInfo, tpl.applies_to_filter || {}, regStates)) {
      templateExpectations.push({
        document_type: tpl.document_type,
        document_category: tpl.document_category,
        is_required: tpl.is_required,
        source: "template",
        template_id: tpl.id,
        notes: tpl.description,
      });
    }
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
    .is("deleted_at", null);

  let applied = 0;
  for (const entity of entities || []) {
    // Fetch registrations for state filter
    const { data: regs } = await admin
      .from("entity_registrations")
      .select("jurisdiction")
      .eq("entity_id", entity.id);
    const regStates = (regs || []).map((r: { jurisdiction: string }) => r.jurisdiction);

    if (!matchesFilter(entity as EntityInfo, template.applies_to_filter || {}, regStates)) continue;

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
 * After a document is created/ingested, check if it satisfies any expectations for its entity.
 */
export async function checkAndSatisfyExpectations(documentId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("documents")
    .select("id, entity_id, document_type, document_category, deleted_at")
    .eq("id", documentId)
    .single();

  if (!doc || !doc.entity_id || doc.deleted_at) return;

  // Find unsatisfied expectations matching this doc type or category
  const { data: expectations } = await admin
    .from("entity_document_expectations")
    .select("id, document_type, document_category")
    .eq("entity_id", doc.entity_id)
    .eq("is_satisfied", false)
    .eq("is_not_applicable", false);

  for (const exp of expectations || []) {
    // Exact document_type match
    const typeMatch = exp.document_type === doc.document_type;
    // Broader category match for generic expectations
    const categoryMatch = exp.document_category === doc.document_category && !typeMatch;

    if (typeMatch || categoryMatch) {
      await admin
        .from("entity_document_expectations")
        .update({
          is_satisfied: true,
          satisfied_by: doc.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", exp.id);
      // Only satisfy one expectation per document (prefer exact match)
      if (typeMatch) break;
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
 * Recheck all expectations for an entity by scanning its current documents.
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

  // Fetch current documents for the entity
  const { data: docs } = await admin
    .from("documents")
    .select("id, document_type, document_category")
    .eq("entity_id", entityId)
    .is("deleted_at", null);

  // Check each document against expectations
  for (const doc of docs || []) {
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
