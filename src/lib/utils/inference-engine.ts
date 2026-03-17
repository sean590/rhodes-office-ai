/**
 * Inference Engine — Feature 5: Inferred Expectations
 *
 * Detects document patterns across the organization and generates
 * suggestions (is_suggestion=true expectations) on entity checklists.
 *
 * Pattern types:
 * 1. Cross-entity: "17 of 20 LLCs have X, 3 are missing"
 * 2. Annual recurrence: "You have 2023 and 2024 K-1s but not 2025"
 * 3. Lifecycle gaps: "Entity formed 2 years ago but no annual report"
 * 4. Service provider: "Every entity with Ridge has a service agreement except X"
 * 5. State compliance: "CA-registered entities need Statement of Information"
 */

import { createAdminClient } from "@/lib/supabase/admin";

// --- Types ---

export interface InferredPattern {
  pattern_type: string;
  document_type: string;
  document_category: string;
  description: string;
  evidence: PatternEvidence;
  confidence: number;
  entity_coverage: number;
  /** Entity IDs that should get suggestions */
  target_entity_ids: string[];
}

interface PatternEvidence {
  entities_with: string[];
  entities_without: string[];
  sample_documents?: string[];
  total_matching_entities?: number;
  years_detected?: number[];
  missing_year?: number;
  relationship_name?: string;
  state?: string;
}

interface EntityRow {
  id: string;
  type: string;
  name: string;
  legal_structure: string | null;
  formation_state: string | null;
  formed_date: string | null;
  organization_id: string;
}

interface DocumentRow {
  id: string;
  entity_id: string;
  document_type: string;
  document_category: string;
  year: number | null;
}

// Confidence thresholds
const SUGGESTION_THRESHOLD = 0.7; // Auto-create suggestion
// const CHAT_ONLY_THRESHOLD = 0.4; // Surface in chat only (used for future filtering)

// Minimum entity count for cross-entity patterns
const MIN_ENTITIES_FOR_PATTERN = 2;
// Minimum coverage ratio for cross-entity patterns
const MIN_COVERAGE_RATIO = 0.5;

// --- Main Entry Point ---

/**
 * Run the full inference engine for an org. Detects patterns, stores them,
 * and generates suggestion expectations on entity checklists.
 */
export interface InferenceResult {
  patterns: InferredPattern[];
  diagnostics: {
    cross_entity: number;
    annual_recurrence: number;
    lifecycle: number;
    service_provider: number;
    state_compliance: number;
    investor_needs: number;
    suggestions_created: number;
    entities_scanned: number;
    documents_scanned: number;
  };
}

export async function runInferenceEngine(orgId: string): Promise<InferenceResult> {
  const admin = createAdminClient();

  // Get counts for diagnostics
  const [entRes, docRes] = await Promise.all([
    admin.from("entities").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    admin.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId).is("deleted_at", null),
  ]);

  const allPatterns: InferredPattern[] = [];

  const [crossEntity, recurrence, lifecycle, serviceProvider, stateCompliance, investorNeeds] = await Promise.all([
    detectCrossEntityPatterns(orgId),
    detectAnnualRecurrences(orgId),
    detectLifecycleGaps(orgId),
    detectServiceProviderPatterns(orgId),
    detectStateComplianceGaps(orgId),
    detectInvestorNeeds(orgId),
  ]);

  allPatterns.push(...crossEntity, ...recurrence, ...lifecycle, ...serviceProvider, ...stateCompliance, ...investorNeeds);

  // Store patterns and generate suggestions
  await storePatterns(orgId, allPatterns);
  const suggestionsCreated = await generateSuggestions(orgId, allPatterns);

  return {
    patterns: allPatterns,
    diagnostics: {
      cross_entity: crossEntity.length,
      annual_recurrence: recurrence.length,
      lifecycle: lifecycle.length,
      service_provider: serviceProvider.length,
      state_compliance: stateCompliance.length,
      investor_needs: investorNeeds.length,
      suggestions_created: suggestionsCreated,
      entities_scanned: entRes.count || 0,
      documents_scanned: docRes.count || 0,
    },
  };
}

/**
 * Run inference for a single entity (lighter weight, used after uploads).
 */
export async function runEntityInference(orgId: string, _entityId: string): Promise<void> {
  // Run full org patterns — suggestions are generated for all target entities
  await runInferenceEngine(orgId).catch((err) => {
    console.error("Background inference error:", err);
  });
}

// --- Pattern Detectors ---

/**
 * Cross-entity: finds document types that most entities of a type have,
 * and flags the ones that don't.
 *
 * "17 of 20 LLCs have a Ridge Service Agreement. 3 are missing one."
 */
export async function detectCrossEntityPatterns(orgId: string): Promise<InferredPattern[]> {
  const admin = createAdminClient();
  const patterns: InferredPattern[] = [];

  // Fetch all entities
  const { data: entities } = await admin
    .from("entities")
    .select("id, type, name, legal_structure, formation_state, formed_date, organization_id")
    .eq("organization_id", orgId);
  if (!entities || entities.length < MIN_ENTITIES_FOR_PATTERN) return patterns;

  // Fetch all documents for these entities
  const entityIds = entities.map((e: EntityRow) => e.id);
  const { data: documents } = await admin
    .from("documents")
    .select("id, entity_id, document_type, document_category, year")
    .in("entity_id", entityIds)
    .is("deleted_at", null);
  if (!documents) return patterns;

  // Fetch existing expectations to avoid re-suggesting dismissed items
  const { data: existingExpectations } = await admin
    .from("entity_document_expectations")
    .select("entity_id, document_type, is_not_applicable, is_suggestion, source")
    .in("entity_id", entityIds);

  const dismissedSet = new Set(
    (existingExpectations || [])
      .filter((e: Record<string, unknown>) => e.is_not_applicable)
      .map((e: Record<string, unknown>) => `${e.entity_id}:${e.document_type}`)
  );

  const confirmedSet = new Set(
    (existingExpectations || [])
      .filter((e: Record<string, unknown>) => !e.is_suggestion && e.source !== "inferred")
      .map((e: Record<string, unknown>) => `${e.entity_id}:${e.document_type}`)
  );

  // Group entities by type
  const entityByType = new Map<string, EntityRow[]>();
  for (const e of entities as EntityRow[]) {
    const group = entityByType.get(e.type) || [];
    group.push(e);
    entityByType.set(e.type, group);
  }

  // For each entity type group, find doc types that most entities have
  for (const [entityType, typeEntities] of entityByType) {
    if (typeEntities.length < MIN_ENTITIES_FOR_PATTERN) continue;

    // Count which doc types appear across entities in this group
    const docTypePresence = new Map<string, Set<string>>(); // doc_type -> set of entity IDs that have it
    const docTypeCategory = new Map<string, string>(); // doc_type -> category
    const docTypeSamples = new Map<string, string[]>(); // doc_type -> sample doc IDs

    const typeEntityIds = new Set(typeEntities.map((e) => e.id));

    for (const doc of documents as DocumentRow[]) {
      if (!typeEntityIds.has(doc.entity_id)) continue;

      const present = docTypePresence.get(doc.document_type) || new Set();
      present.add(doc.entity_id);
      docTypePresence.set(doc.document_type, present);

      if (!docTypeCategory.has(doc.document_type)) {
        docTypeCategory.set(doc.document_type, doc.document_category);
      }

      const samples = docTypeSamples.get(doc.document_type) || [];
      if (samples.length < 3) samples.push(doc.id);
      docTypeSamples.set(doc.document_type, samples);
    }

    // Find doc types with high coverage
    for (const [docType, presentEntities] of docTypePresence) {
      const coverage = presentEntities.size / typeEntities.length;
      if (coverage < MIN_COVERAGE_RATIO) continue;
      if (presentEntities.size === typeEntities.length) continue; // all have it, no suggestion needed

      const entitiesWithout = typeEntities
        .filter((e) => !presentEntities.has(e.id))
        .filter((e) => !dismissedSet.has(`${e.id}:${docType}`))
        .filter((e) => !confirmedSet.has(`${e.id}:${docType}`));

      if (entitiesWithout.length === 0) continue;

      const category = docTypeCategory.get(docType) || "other";

      patterns.push({
        pattern_type: "cross_entity",
        document_type: docType,
        document_category: category,
        description: `${presentEntities.size} of ${typeEntities.length} ${formatEntityType(entityType)} entities have this document. ${entitiesWithout.length} are missing it.`,
        evidence: {
          entities_with: [...presentEntities],
          entities_without: entitiesWithout.map((e) => e.id),
          sample_documents: docTypeSamples.get(docType) || [],
          total_matching_entities: typeEntities.length,
        },
        confidence: coverage,
        entity_coverage: coverage,
        target_entity_ids: entitiesWithout.map((e) => e.id),
      });
    }
  }

  return patterns;
}

/**
 * Annual recurrence: detects yearly document patterns and flags missing years.
 *
 * "You uploaded a 2023 K-1 and 2024 K-1 but are missing 2025."
 */
export async function detectAnnualRecurrences(orgId: string): Promise<InferredPattern[]> {
  const admin = createAdminClient();
  const patterns: InferredPattern[] = [];
  const currentYear = new Date().getFullYear();

  const { data: entities } = await admin
    .from("entities")
    .select("id, type, name, legal_structure, formation_state, formed_date, organization_id")
    .eq("organization_id", orgId);
  if (!entities) return patterns;

  const entityIds = entities.map((e: EntityRow) => e.id);
  const { data: documents } = await admin
    .from("documents")
    .select("id, entity_id, document_type, document_category, year")
    .in("entity_id", entityIds)
    .is("deleted_at", null)
    .not("year", "is", null);
  if (!documents) return patterns;

  // Fetch dismissed expectations
  const { data: existingExpectations } = await admin
    .from("entity_document_expectations")
    .select("entity_id, document_type, is_not_applicable")
    .in("entity_id", entityIds);
  const dismissedSet = new Set(
    (existingExpectations || [])
      .filter((e: Record<string, unknown>) => e.is_not_applicable)
      .map((e: Record<string, unknown>) => `${e.entity_id}:${e.document_type}`)
  );

  // Group by entity + doc type, collect years
  const entityDocYears = new Map<string, Set<number>>(); // "entityId:docType" -> years
  const entityDocCategory = new Map<string, string>();
  const entityDocSamples = new Map<string, string[]>();

  for (const doc of documents as DocumentRow[]) {
    if (!doc.year) continue;
    const key = `${doc.entity_id}:${doc.document_type}`;
    const years = entityDocYears.get(key) || new Set();
    years.add(doc.year);
    entityDocYears.set(key, years);

    if (!entityDocCategory.has(key)) {
      entityDocCategory.set(key, doc.document_category);
    }
    const samples = entityDocSamples.get(key) || [];
    if (samples.length < 3) samples.push(doc.id);
    entityDocSamples.set(key, samples);
  }

  const entityMap = new Map((entities as EntityRow[]).map((e) => [e.id, e]));

  // Fetch active termination signals for all entities
  const { data: allSignals } = await admin
    .from("entity_recurrence_signals")
    .select("entity_id, document_types_affected, related_entity_id, effective_date, reason")
    .eq("organization_id", orgId)
    .eq("is_active", true);
  const signalsByEntity = new Map<string, Array<{ document_types_affected: string[]; related_entity_id: string | null; effective_date: string | null; reason: string }>>();
  for (const sig of allSignals || []) {
    const arr = signalsByEntity.get(sig.entity_id) || [];
    arr.push(sig);
    signalsByEntity.set(sig.entity_id, arr);
  }

  // For each entity+docType combo with 2+ years, check for gaps
  for (const [key, years] of entityDocYears) {
    if (years.size < 2) continue; // need at least 2 years to detect pattern

    const [entityId, docType] = key.split(":");
    const sortedYears = [...years].sort((a, b) => a - b);
    const maxYear = sortedYears[sortedYears.length - 1];

    // Check for missing recent year (within last 2 years)
    if (maxYear < currentYear - 1) {
      // The most recent doc is older than last year — likely missing current/recent
      const missingYear = maxYear + 1;
      if (missingYear > currentYear) continue; // don't suggest future years

      if (dismissedSet.has(`${entityId}:${docType}`)) continue;

      // Check termination signals — suppress if a signal covers this doc type
      const entitySignals = signalsByEntity.get(entityId) || [];
      const suppressingSignal = entitySignals.find((s) => {
        if (!s.document_types_affected.includes(docType)) return false;
        // If signal has an effective date, only suppress if it's before the missing year
        if (s.effective_date) {
          const effectiveYear = new Date(s.effective_date).getFullYear();
          return effectiveYear <= maxYear;
        }
        return true;
      });
      if (suppressingSignal) continue; // Signal suppresses this expectation

      const entity = entityMap.get(entityId);
      if (!entity) continue;

      const confidence = Math.min(0.9, 0.5 + years.size * 0.1); // More years = higher confidence

      patterns.push({
        pattern_type: "annual_recurrence",
        document_type: docType,
        document_category: entityDocCategory.get(key) || "other",
        description: `${entity.name} has this document for ${sortedYears.join(", ")} but is missing ${missingYear}.`,
        evidence: {
          entities_with: [],
          entities_without: [entityId],
          sample_documents: entityDocSamples.get(key) || [],
          years_detected: sortedYears,
          missing_year: missingYear,
        },
        confidence,
        entity_coverage: (years.size) / (years.size + 1),
        target_entity_ids: [entityId],
      });
    }
  }

  return patterns;
}

/**
 * Lifecycle gaps: entities formed X years ago that are missing expected compliance docs.
 *
 * "This entity was formed 2 years ago but has no annual report on file."
 */
export async function detectLifecycleGaps(orgId: string): Promise<InferredPattern[]> {
  const admin = createAdminClient();
  const patterns: InferredPattern[] = [];
  const now = new Date();

  const { data: entities } = await admin
    .from("entities")
    .select("id, type, name, legal_structure, formation_state, formed_date, organization_id")
    .eq("organization_id", orgId)
    .not("formed_date", "is", null);
  if (!entities) return patterns;

  const entityIds = entities.map((e: EntityRow) => e.id);

  // Fetch existing docs and expectations
  const [docsRes, expectRes] = await Promise.all([
    admin
      .from("documents")
      .select("entity_id, document_type")
      .in("entity_id", entityIds)
      .is("deleted_at", null),
    admin
      .from("entity_document_expectations")
      .select("entity_id, document_type, is_not_applicable")
      .in("entity_id", entityIds),
  ]);

  const entityDocs = new Map<string, Set<string>>();
  for (const doc of docsRes.data || []) {
    const set = entityDocs.get(doc.entity_id) || new Set();
    set.add(doc.document_type);
    entityDocs.set(doc.entity_id, set);
  }

  const dismissedSet = new Set(
    (expectRes.data || [])
      .filter((e: Record<string, unknown>) => e.is_not_applicable)
      .map((e: Record<string, unknown>) => `${e.entity_id}:${e.document_type}`)
  );

  // Lifecycle rules: if entity is > 1 year old, should have annual report
  // Trusts don't file annual reports or SOIs — only LLCs, corps, LPs do
  const TRUST_TYPES = new Set(["trust"]);
  const lifecycleChecks = [
    {
      minAge: 1,
      document_type: "annual_report",
      document_category: "compliance",
      excludeTypes: TRUST_TYPES,
      description: (name: string, years: number) =>
        `${name} was formed ${years} year${years > 1 ? "s" : ""} ago but has no annual report on file.`,
    },
    {
      minAge: 0.5,
      document_type: "federal_tax_return",
      document_category: "tax",
      excludeTypes: null as Set<string> | null,
      description: (name: string, years: number) =>
        `${name} was formed ${years} year${years > 1 ? "s" : ""} ago but has no federal tax return on file.`,
    },
  ];

  for (const entity of entities as EntityRow[]) {
    if (!entity.formed_date) continue;
    const formed = new Date(entity.formed_date);
    const ageYears = (now.getTime() - formed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

    const docs = entityDocs.get(entity.id) || new Set();

    for (const check of lifecycleChecks) {
      if (ageYears < check.minAge) continue;
      if (check.excludeTypes?.has(entity.type)) continue;
      if (docs.has(check.document_type)) continue;
      if (dismissedSet.has(`${entity.id}:${check.document_type}`)) continue;

      const roundedAge = Math.floor(ageYears);
      const confidence = Math.min(0.85, 0.5 + ageYears * 0.1);

      patterns.push({
        pattern_type: "lifecycle",
        document_type: check.document_type,
        document_category: check.document_category,
        description: check.description(entity.name, roundedAge || 1),
        evidence: {
          entities_with: [],
          entities_without: [entity.id],
        },
        confidence,
        entity_coverage: 0,
        target_entity_ids: [entity.id],
      });
    }
  }

  return patterns;
}

/**
 * Service provider: entities related to the same directory entry should have
 * similar documents.
 *
 * "Every entity with Ridge Capital has a service agreement except Entity X."
 */
export async function detectServiceProviderPatterns(orgId: string): Promise<InferredPattern[]> {
  const admin = createAdminClient();
  const patterns: InferredPattern[] = [];

  // Fetch relationships with directory entries
  const { data: relationships } = await admin
    .from("relationships")
    .select("id, type, from_entity_id, to_entity_id, from_directory_id, to_directory_id")
    .eq("organization_id", orgId);
  if (!relationships || relationships.length === 0) return patterns;

  // Get all entities
  const { data: entities } = await admin
    .from("entities")
    .select("id, type, name, legal_structure, formation_state, formed_date, organization_id")
    .eq("organization_id", orgId);
  if (!entities) return patterns;

  const entityMap = new Map((entities as EntityRow[]).map((e) => [e.id, e]));
  const entityIds = entities.map((e: EntityRow) => e.id);

  // Get directory entries for names
  const { data: dirEntries } = await admin
    .from("directory_entries")
    .select("id, name")
    .eq("organization_id", orgId);
  const dirMap = new Map((dirEntries || []).map((d: { id: string; name: string }) => [d.id, d.name]));

  // Get all docs
  const { data: documents } = await admin
    .from("documents")
    .select("entity_id, document_type, document_category")
    .in("entity_id", entityIds)
    .is("deleted_at", null);

  const entityDocs = new Map<string, Set<string>>();
  for (const doc of documents || []) {
    const set = entityDocs.get(doc.entity_id) || new Set();
    set.add(doc.document_type);
    entityDocs.set(doc.entity_id, set);
  }

  // Fetch dismissed
  const { data: existingExp } = await admin
    .from("entity_document_expectations")
    .select("entity_id, document_type, is_not_applicable")
    .in("entity_id", entityIds);
  const dismissedSet = new Set(
    (existingExp || [])
      .filter((e: Record<string, unknown>) => e.is_not_applicable)
      .map((e: Record<string, unknown>) => `${e.entity_id}:${e.document_type}`)
  );

  // Group entities by related directory entry
  const dirEntityMap = new Map<string, Set<string>>(); // dir_id -> set of entity IDs
  for (const rel of relationships) {
    const entityId = rel.from_entity_id || rel.to_entity_id;
    const dirId = rel.from_directory_id || rel.to_directory_id;
    if (!entityId || !dirId) continue;

    const set = dirEntityMap.get(dirId) || new Set();
    set.add(entityId);
    dirEntityMap.set(dirId, set);
  }

  // For each directory entry with multiple related entities,
  // find doc types that most related entities have
  for (const [dirId, relatedEntityIds] of dirEntityMap) {
    if (relatedEntityIds.size < MIN_ENTITIES_FOR_PATTERN) continue;
    const dirName = dirMap.get(dirId) || "Unknown";

    // Count doc type presence across related entities
    const docTypePresence = new Map<string, Set<string>>();
    const docTypeCategory = new Map<string, string>();

    for (const eid of relatedEntityIds) {
      const docs = entityDocs.get(eid) || new Set();
      for (const docType of docs) {
        const present = docTypePresence.get(docType) || new Set();
        present.add(eid);
        docTypePresence.set(docType, present);
      }
    }

    // Map categories from documents
    for (const doc of documents || []) {
      if (relatedEntityIds.has(doc.entity_id) && !docTypeCategory.has(doc.document_type)) {
        docTypeCategory.set(doc.document_type, doc.document_category);
      }
    }

    for (const [docType, presentEntities] of docTypePresence) {
      const coverage = presentEntities.size / relatedEntityIds.size;
      if (coverage < MIN_COVERAGE_RATIO) continue;
      if (presentEntities.size === relatedEntityIds.size) continue;

      const missing = [...relatedEntityIds]
        .filter((eid) => !presentEntities.has(eid))
        .filter((eid) => !dismissedSet.has(`${eid}:${docType}`))
        .filter((eid) => entityMap.has(eid));

      if (missing.length === 0) continue;

      patterns.push({
        pattern_type: "service_provider",
        document_type: docType,
        document_category: docTypeCategory.get(docType) || "other",
        description: `Every entity related to ${dirName} has this document except ${missing.length} entit${missing.length === 1 ? "y" : "ies"}.`,
        evidence: {
          entities_with: [...presentEntities],
          entities_without: missing,
          relationship_name: dirName,
          total_matching_entities: relatedEntityIds.size,
        },
        confidence: coverage,
        entity_coverage: coverage,
        target_entity_ids: missing,
      });
    }
  }

  return patterns;
}

/**
 * State compliance: entities registered in certain states should have
 * state-specific compliance documents.
 *
 * "3 CA-registered entities are missing Statement of Information filings."
 */
export async function detectStateComplianceGaps(orgId: string): Promise<InferredPattern[]> {
  const admin = createAdminClient();
  const patterns: InferredPattern[] = [];

  // State-specific required documents
  // excludeTypes: entity types that don't file this document (trusts don't file SOIs, annual reports, franchise tax, etc.)
  const TRUST_TYPES = new Set(["trust"]);
  const stateRequirements: Array<{
    state: string;
    document_type: string;
    document_category: string;
    label: string;
    excludeTypes?: Set<string>;
  }> = [
    { state: "CA", document_type: "statement_of_information", document_category: "compliance", label: "Statement of Information", excludeTypes: TRUST_TYPES },
    { state: "DE", document_type: "annual_franchise_tax", document_category: "tax", label: "Annual Franchise Tax", excludeTypes: TRUST_TYPES },
    { state: "NY", document_type: "biennial_statement", document_category: "compliance", label: "Biennial Statement", excludeTypes: TRUST_TYPES },
    { state: "TX", document_type: "franchise_tax_report", document_category: "tax", label: "Franchise Tax Report", excludeTypes: TRUST_TYPES },
    { state: "FL", document_type: "annual_report", document_category: "compliance", label: "Annual Report", excludeTypes: TRUST_TYPES },
    { state: "NV", document_type: "annual_list", document_category: "compliance", label: "Annual List of Officers", excludeTypes: TRUST_TYPES },
  ];

  // Fetch org entities first, then their registrations
  const { data: orgEntities } = await admin
    .from("entities")
    .select("id, type")
    .eq("organization_id", orgId);
  if (!orgEntities || orgEntities.length === 0) return patterns;

  const orgEntityIds = orgEntities.map((e: { id: string }) => e.id);
  const entityTypeMap = new Map(orgEntities.map((e: { id: string; type: string }) => [e.id, e.type]));

  const { data: registrations } = await admin
    .from("entity_registrations")
    .select("entity_id, jurisdiction")
    .in("entity_id", orgEntityIds);
  if (!registrations || registrations.length === 0) return patterns;

  const entityIds = [...new Set(registrations.map((r: { entity_id: string }) => r.entity_id))];

  // Fetch entities for names
  // Fetch documents
  const { data: documents } = await admin
    .from("documents")
    .select("entity_id, document_type")
    .in("entity_id", entityIds)
    .is("deleted_at", null);
  const entityDocs = new Map<string, Set<string>>();
  for (const doc of documents || []) {
    const set = entityDocs.get(doc.entity_id) || new Set();
    set.add(doc.document_type);
    entityDocs.set(doc.entity_id, set);
  }

  // Fetch dismissed
  const { data: existingExp } = await admin
    .from("entity_document_expectations")
    .select("entity_id, document_type, is_not_applicable")
    .in("entity_id", entityIds);
  const dismissedSet = new Set(
    (existingExp || [])
      .filter((e: Record<string, unknown>) => e.is_not_applicable)
      .map((e: Record<string, unknown>) => `${e.entity_id}:${e.document_type}`)
  );

  // Group registrations by state
  const stateEntities = new Map<string, string[]>();
  for (const reg of registrations) {
    const arr = stateEntities.get(reg.jurisdiction) || [];
    arr.push(reg.entity_id);
    stateEntities.set(reg.jurisdiction, arr);
  }

  for (const req of stateRequirements) {
    const entitiesInState = stateEntities.get(req.state);
    if (!entitiesInState || entitiesInState.length === 0) continue;

    const missing = entitiesInState.filter((eid) => {
      if (req.excludeTypes?.has(entityTypeMap.get(eid) || "")) return false;
      const docs = entityDocs.get(eid) || new Set();
      return !docs.has(req.document_type) && !dismissedSet.has(`${eid}:${req.document_type}`);
    });

    if (missing.length === 0) continue;

    const entitiesWithDoc = entitiesInState.filter((eid) => {
      const docs = entityDocs.get(eid) || new Set();
      return docs.has(req.document_type);
    });

    patterns.push({
      pattern_type: "state_compliance",
      document_type: req.document_type,
      document_category: req.document_category,
      description: `${missing.length} ${req.state}-registered entit${missing.length === 1 ? "y is" : "ies are"} missing ${req.label}.`,
      evidence: {
        entities_with: entitiesWithDoc,
        entities_without: missing,
        state: req.state,
      },
      confidence: 0.85,
      entity_coverage: entitiesWithDoc.length / entitiesInState.length,
      target_entity_ids: missing,
    });
  }

  return patterns;
}

/**
 * Investor/stakeholder: entities with investors (cap table entries) should
 * have investor-related documents (K-1s, distribution notices, etc.).
 *
 * "Entity X has 5 investors but no K-1s on file."
 */
export async function detectInvestorNeeds(orgId: string): Promise<InferredPattern[]> {
  const admin = createAdminClient();
  const patterns: InferredPattern[] = [];

  // Fetch org entities first, then their cap table entries
  const { data: orgEntities } = await admin
    .from("entities")
    .select("id")
    .eq("organization_id", orgId);
  if (!orgEntities || orgEntities.length === 0) return patterns;

  const orgEntityIds = orgEntities.map((e: { id: string }) => e.id);

  const { data: capEntries } = await admin
    .from("cap_table_entries")
    .select("entity_id, investor_name")
    .in("entity_id", orgEntityIds);
  if (!capEntries || capEntries.length === 0) return patterns;

  // Group by entity
  const entityInvestors = new Map<string, string[]>();
  for (const entry of capEntries) {
    const arr = entityInvestors.get(entry.entity_id) || [];
    arr.push(entry.investor_name || "Unknown");
    entityInvestors.set(entry.entity_id, arr);
  }

  const entityIds = [...entityInvestors.keys()];

  // Fetch entities for names
  const { data: entities } = await admin
    .from("entities")
    .select("id, name")
    .in("id", entityIds);
  const entityMap = new Map((entities || []).map((e: { id: string; name: string }) => [e.id, e.name]));

  // Fetch documents
  const { data: documents } = await admin
    .from("documents")
    .select("entity_id, document_type")
    .in("entity_id", entityIds)
    .is("deleted_at", null);
  const entityDocs = new Map<string, Set<string>>();
  for (const doc of documents || []) {
    const set = entityDocs.get(doc.entity_id) || new Set();
    set.add(doc.document_type);
    entityDocs.set(doc.entity_id, set);
  }

  // Fetch dismissed
  const { data: existingExp } = await admin
    .from("entity_document_expectations")
    .select("entity_id, document_type, is_not_applicable")
    .in("entity_id", entityIds);
  const dismissedSet = new Set(
    (existingExp || [])
      .filter((e: Record<string, unknown>) => e.is_not_applicable)
      .map((e: Record<string, unknown>) => `${e.entity_id}:${e.document_type}`)
  );

  // Investor-related document types expected when entity has investors
  const investorDocTypes = [
    { type: "k1", category: "tax", label: "K-1" },
    { type: "subscription_agreement", category: "investor", label: "Subscription Agreement" },
  ];

  for (const [entityId, investors] of entityInvestors) {
    if (investors.length === 0) continue;
    const docs = entityDocs.get(entityId) || new Set();
    const entityName = entityMap.get(entityId) || "Unknown";

    for (const docReq of investorDocTypes) {
      if (docs.has(docReq.type)) continue;
      if (dismissedSet.has(`${entityId}:${docReq.type}`)) continue;

      patterns.push({
        pattern_type: "investor_detection",
        document_type: docReq.type,
        document_category: docReq.category,
        description: `${entityName} has ${investors.length} investor${investors.length !== 1 ? "s" : ""} but no ${docReq.label} on file.`,
        evidence: {
          entities_with: [],
          entities_without: [entityId],
        },
        confidence: Math.min(0.85, 0.6 + investors.length * 0.05),
        entity_coverage: 0,
        target_entity_ids: [entityId],
      });
    }
  }

  return patterns;
}

// --- Termination Signal Utilities ---

export interface EntityRecurrenceSignal {
  id: string;
  entity_id: string;
  signal_type: string;
  related_entity_name: string | null;
  related_entity_id: string | null;
  jurisdiction: string | null;
  effective_date: string | null;
  document_types_affected: string[];
  source_document_id: string;
  confidence: number;
  reason: string;
  is_active: boolean;
}

/**
 * Store a termination signal detected from document extraction.
 */
export async function upsertRecurrenceSignal(
  orgId: string,
  documentId: string,
  signal: {
    signal_type: string;
    entity_id: string;
    related_entity_name: string | null;
    related_entity_id: string | null;
    jurisdiction: string | null;
    effective_date: string | null;
    document_types_affected: string[];
    confidence: string;
    reason: string;
  },
): Promise<void> {
  const admin = createAdminClient();
  const confidenceNum = signal.confidence === "high" ? 0.95 : signal.confidence === "medium" ? 0.7 : 0.4;

  // Check for existing signal from same document
  const { data: existing } = await admin
    .from("entity_recurrence_signals")
    .select("id")
    .eq("source_document_id", documentId)
    .eq("entity_id", signal.entity_id)
    .eq("signal_type", signal.signal_type)
    .maybeSingle();

  if (existing) {
    await admin
      .from("entity_recurrence_signals")
      .update({
        related_entity_name: signal.related_entity_name,
        related_entity_id: signal.related_entity_id,
        jurisdiction: signal.jurisdiction,
        effective_date: signal.effective_date,
        document_types_affected: signal.document_types_affected,
        confidence: confidenceNum,
        reason: signal.reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await admin
      .from("entity_recurrence_signals")
      .insert({
        organization_id: orgId,
        entity_id: signal.entity_id,
        signal_type: signal.signal_type,
        related_entity_name: signal.related_entity_name,
        related_entity_id: signal.related_entity_id,
        jurisdiction: signal.jurisdiction,
        effective_date: signal.effective_date,
        document_types_affected: signal.document_types_affected,
        source_document_id: documentId,
        confidence: confidenceNum,
        reason: signal.reason,
      });
  }
}

/**
 * Get active termination signals that would suppress expectations.
 */
export async function getActiveSignals(
  orgId: string,
  entityId: string,
  documentType?: string,
  relatedEntityId?: string,
): Promise<EntityRecurrenceSignal[]> {
  const admin = createAdminClient();

  let query = admin
    .from("entity_recurrence_signals")
    .select("*")
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .eq("is_active", true);

  if (relatedEntityId) {
    query = query.eq("related_entity_id", relatedEntityId);
  }

  const { data } = await query;
  if (!data) return [];

  // Filter by document type if specified
  if (documentType) {
    return data.filter((s: EntityRecurrenceSignal) =>
      s.document_types_affected.includes(documentType)
    );
  }

  return data as EntityRecurrenceSignal[];
}

/**
 * Re-evaluate existing annual recurrence expectations after a new
 * termination signal is detected. Marks suppressed expectations as N/A.
 */
export async function reevaluateRecurrenceExpectations(
  orgId: string,
  entityId: string,
): Promise<number> {
  const admin = createAdminClient();
  let suppressed = 0;

  // Get active signals for this entity
  const signals = await getActiveSignals(orgId, entityId);
  if (signals.length === 0) return 0;

  // Get unsatisfied, non-NA expectations for this entity
  const { data: expectations } = await admin
    .from("entity_document_expectations")
    .select("id, document_type, is_not_applicable, source")
    .eq("entity_id", entityId)
    .eq("is_not_applicable", false)
    .eq("is_satisfied", false);

  if (!expectations) return 0;

  for (const exp of expectations) {
    // Check if any signal suppresses this expectation
    const matchingSignal = signals.find((s) =>
      s.document_types_affected.includes(exp.document_type)
    );

    if (matchingSignal) {
      await admin
        .from("entity_document_expectations")
        .update({
          is_not_applicable: true,
          inference_reason: `Suppressed: ${matchingSignal.reason}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", exp.id);
      suppressed++;
    }
  }

  return suppressed;
}

// --- Storage & Suggestion Generation ---

/**
 * Store detected patterns in org_document_patterns table.
 * Updates existing patterns or creates new ones.
 */
async function storePatterns(orgId: string, patterns: InferredPattern[]): Promise<void> {
  const admin = createAdminClient();

  for (const pattern of patterns) {
    // Check for existing pattern
    const { data: existing } = await admin
      .from("org_document_patterns")
      .select("id, times_confirmed, times_dismissed, is_active")
      .eq("organization_id", orgId)
      .eq("pattern_type", pattern.pattern_type)
      .eq("document_type", pattern.document_type)
      .maybeSingle();

    if (existing) {
      // Don't reactivate dismissed patterns
      if (!existing.is_active) continue;

      // High dismiss rate → deactivate
      const totalFeedback = existing.times_confirmed + existing.times_dismissed;
      if (totalFeedback > 2 && existing.times_dismissed / totalFeedback > 0.5) {
        await admin
          .from("org_document_patterns")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        continue;
      }

      // Update existing pattern
      await admin
        .from("org_document_patterns")
        .update({
          description: pattern.description,
          evidence: pattern.evidence,
          confidence: pattern.confidence,
          entity_coverage: pattern.entity_coverage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      // Insert new pattern
      await admin
        .from("org_document_patterns")
        .insert({
          organization_id: orgId,
          pattern_type: pattern.pattern_type,
          document_type: pattern.document_type,
          document_category: pattern.document_category,
          description: pattern.description,
          evidence: pattern.evidence,
          confidence: pattern.confidence,
          entity_coverage: pattern.entity_coverage,
        });
    }
  }
}

/**
 * Generate suggestion expectations on entity checklists from patterns.
 * Only creates suggestions for patterns above the confidence threshold.
 */
async function generateSuggestions(orgId: string, patterns: InferredPattern[]): Promise<number> {
  const admin = createAdminClient();
  let created = 0;

  const highConfidence = patterns.filter((p) => p.confidence >= SUGGESTION_THRESHOLD);

  for (const pattern of highConfidence) {
    for (const entityId of pattern.target_entity_ids) {
      // Check if expectation already exists (any source)
      const { data: existing } = await admin
        .from("entity_document_expectations")
        .select("id, is_suggestion, source, is_not_applicable")
        .eq("entity_id", entityId)
        .eq("document_type", pattern.document_type)
        .maybeSingle();

      // Skip if already exists as confirmed expectation or dismissed
      if (existing && (!existing.is_suggestion || existing.is_not_applicable)) continue;

      // Update or insert suggestion
      if (existing) {
        await admin
          .from("entity_document_expectations")
          .update({
            confidence: pattern.confidence,
            inference_reason: pattern.description,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else {
        await admin
          .from("entity_document_expectations")
          .insert({
            entity_id: entityId,
            organization_id: orgId,
            document_type: pattern.document_type,
            document_category: pattern.document_category,
            is_required: false,
            source: "inferred",
            is_suggestion: true,
            confidence: pattern.confidence,
            inference_reason: pattern.description,
          });
        created++;
      }
    }
  }

  return created;
}

// --- Feedback Handlers ---

/**
 * Confirm a suggestion — converts it from suggestion to real checklist item.
 */
export async function confirmSuggestion(expectationId: string): Promise<void> {
  const admin = createAdminClient();

  // Get the expectation to find its pattern
  const { data: exp } = await admin
    .from("entity_document_expectations")
    .select("document_type, organization_id")
    .eq("id", expectationId)
    .single();
  if (!exp) return;

  // Update expectation
  await admin
    .from("entity_document_expectations")
    .update({
      is_suggestion: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expectationId);

  // Increment pattern confirmation count
  const { data: pattern } = await admin
    .from("org_document_patterns")
    .select("id, times_confirmed, confidence")
    .eq("organization_id", exp.organization_id)
    .eq("document_type", exp.document_type)
    .maybeSingle();

  if (pattern) {
    // Confirming a suggestion boosts the pattern's confidence slightly
    const newConfirmed = (pattern.times_confirmed || 0) + 1;
    const confidenceBoost = Math.min(1.0, (pattern.confidence || 0) + 0.03);
    await admin
      .from("org_document_patterns")
      .update({
        times_confirmed: newConfirmed,
        confidence: confidenceBoost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pattern.id);
  }
}

/**
 * Dismiss a suggestion — marks it N/A and increments dismiss count.
 */
export async function dismissSuggestion(expectationId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: exp } = await admin
    .from("entity_document_expectations")
    .select("document_type, organization_id")
    .eq("id", expectationId)
    .single();
  if (!exp) return;

  await admin
    .from("entity_document_expectations")
    .update({
      is_not_applicable: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expectationId);

  // Increment dismiss count on pattern
  const { data: pattern } = await admin
    .from("org_document_patterns")
    .select("id, times_dismissed, confidence")
    .eq("organization_id", exp.organization_id)
    .eq("document_type", exp.document_type)
    .maybeSingle();

  if (pattern) {
    // Dismissing a suggestion lowers the pattern's confidence
    const newDismissed = (pattern.times_dismissed || 0) + 1;
    const confidencePenalty = Math.max(0.1, (pattern.confidence || 0) - 0.05);
    await admin
      .from("org_document_patterns")
      .update({
        times_dismissed: newDismissed,
        confidence: confidencePenalty,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pattern.id);
  }
}

/**
 * Promote a pattern to an org-wide template.
 */
export async function promoteToTemplate(
  patternId: string,
  orgId: string,
  userId: string,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data: pattern } = await admin
    .from("org_document_patterns")
    .select("*")
    .eq("id", patternId)
    .single();
  if (!pattern) return null;

  // Create template
  const { data: template, error } = await admin
    .from("document_expectation_templates")
    .insert({
      organization_id: orgId,
      document_type: pattern.document_type,
      document_category: pattern.document_category,
      is_required: false,
      description: pattern.description,
      source: "custom",
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    // Likely duplicate — template already exists
    console.error("Promote to template error:", error.message);
    return null;
  }

  // Link pattern to template and boost confidence (promotion is strongest positive signal)
  await admin
    .from("org_document_patterns")
    .update({
      promoted_to_template_id: template.id,
      times_confirmed: (pattern.times_confirmed || 0) + 5,
      confidence: Math.min(1.0, (pattern.confidence || 0) + 0.15),
      updated_at: new Date().toISOString(),
    })
    .eq("id", patternId);

  // Boost related patterns of the same type (promoting a cross-entity pattern
  // signals the user cares about document coverage, so similar patterns get a nudge)
  if (pattern.pattern_type === "cross_entity") {
    const { data: siblings } = await admin
      .from("org_document_patterns")
      .select("id, confidence, times_confirmed")
      .eq("organization_id", orgId)
      .eq("pattern_type", "cross_entity")
      .eq("is_active", true)
      .is("promoted_to_template_id", null)
      .neq("id", patternId);

    for (const sib of siblings || []) {
      await admin
        .from("org_document_patterns")
        .update({
          confidence: Math.min(1.0, (sib.confidence || 0) + 0.05),
          updated_at: new Date().toISOString(),
        })
        .eq("id", sib.id);
    }
  }

  // Apply template to all matching entities (backfill)
  const { applyTemplate } = await import("./document-expectations");
  await applyTemplate(template.id);

  return template.id;
}

// --- Helpers ---

function formatEntityType(type: string): string {
  return type.replace(/_/g, " ");
}
