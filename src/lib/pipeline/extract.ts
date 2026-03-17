/**
 * Shared extraction logic — used by both the pipeline worker and the
 * existing /api/documents/[id]/process route for one-off reprocessing.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getDocumentTypes } from "@/lib/document-types";
import { analyzePdf, buildPdfContent } from "./pdf-processor";

// Re-export for convenience
export type { PDFAnalysis } from "./pdf-processor";

/**
 * Compute a numeric confidence score from action-level string confidences.
 * Maps: high → 0.95, medium → 0.7, low → 0.3
 */
function computeConfidence(actions: unknown[]): number | null {
  if (actions.length === 0) return null;
  const confidenceMap: Record<string, number> = { high: 0.95, medium: 0.7, low: 0.3 };
  let sum = 0;
  let count = 0;
  for (const action of actions) {
    const conf = (action as Record<string, unknown>)?.confidence;
    if (typeof conf === "string" && conf in confidenceMap) {
      sum += confidenceMap[conf];
      count++;
    }
  }
  return count > 0 ? Math.round((sum / count) * 100) / 100 : null;
}

// --- DB Context Builder ---

export async function getDbContext(supabase: ReturnType<typeof createAdminClient>, orgId?: string) {
  // Phase 1: Fetch org-scoped root tables + entities (need entity IDs for sub-table filtering)
  const entitiesQuery = supabase
    .from("entities")
    .select("id, name, short_name, type, ein, formation_state, status, business_purpose")
    .order("name");
  const directoryQuery = supabase
    .from("directory_entries")
    .select("id, name, type, email, aliases")
    .order("name");
  const relationshipsQuery = supabase
    .from("relationships")
    .select("id, type, from_entity_id, to_entity_id, description");
  const complianceQuery = supabase
    .from("compliance_obligations")
    .select("id, entity_id, name, jurisdiction, obligation_type, status, next_due_date, completed_at, rule_id")
    .order("next_due_date", { ascending: true });

  if (orgId) {
    entitiesQuery.eq("organization_id", orgId);
    directoryQuery.eq("organization_id", orgId);
    relationshipsQuery.eq("organization_id", orgId);
    complianceQuery.eq("organization_id", orgId);
  }

  const [entitiesRes, directoryRes, relationshipsRes, complianceRes] = await Promise.all([
    entitiesQuery, directoryQuery, relationshipsQuery, complianceQuery,
  ]);

  const entities = entitiesRes.data || [];
  const entityIds = entities.map((e) => e.id);

  // Phase 2: Fetch sub-entity tables, scoped by entity IDs
  const subQueries = entityIds.length > 0
    ? await Promise.all([
        supabase.from("entity_registrations").select("id, entity_id, jurisdiction, qualification_date, last_filing_date, state_id").in("entity_id", entityIds),
        supabase.from("entity_managers").select("entity_id, name").in("entity_id", entityIds),
        supabase.from("entity_members").select("entity_id, name").in("entity_id", entityIds),
        supabase.from("trust_details").select("id, entity_id, trust_type, grantor_name").in("entity_id", entityIds),
        supabase.from("cap_table_entries").select("entity_id, investor_name, ownership_pct").in("entity_id", entityIds),
        supabase.from("entity_partnership_reps").select("entity_id, name").in("entity_id", entityIds),
        supabase.from("entity_roles").select("entity_id, role_title, name").in("entity_id", entityIds),
      ])
    : Array(7).fill({ data: [] });

  const trustDetails = subQueries[3].data || [];
  const trustDetailIds = trustDetails.map((t: { id: string }) => t.id);

  // Trust roles are keyed by trust_detail_id, not entity_id
  const trustRolesRes = trustDetailIds.length > 0
    ? await supabase.from("trust_roles").select("trust_detail_id, role, name").in("trust_detail_id", trustDetailIds)
    : { data: [] };

  return {
    entities,
    directory: directoryRes.data || [],
    relationships: relationshipsRes.data || [],
    registrations: subQueries[0].data || [],
    managers: subQueries[1].data || [],
    members: subQueries[2].data || [],
    trust_details: trustDetails,
    trust_roles: trustRolesRes.data || [],
    cap_table: subQueries[4].data || [],
    partnership_reps: subQueries[5].data || [],
    entity_roles: subQueries[6].data || [],
    compliance_obligations: complianceRes.data || [],
  };
}

// --- System Prompt Builder ---

export async function buildSystemPrompt(
  dbContext: Record<string, unknown[]>,
  options?: { entityDiscovery?: boolean; compositeDetection?: boolean }
): Promise<string> {
  // Fetch dynamic document types for the prompt
  const docTypes = await getDocumentTypes();
  const typesByCategory: Record<string, string[]> = {};
  for (const dt of docTypes) {
    if (!typesByCategory[dt.category]) typesByCategory[dt.category] = [];
    typesByCategory[dt.category].push(dt.slug);
  }

  const typeListStr = Object.entries(typesByCategory)
    .map(([cat, slugs]) => `${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${slugs.join(", ")}`)
    .join("\n");

  let prompt = `You are an AI assistant that analyzes legal and financial documents for a family office entity management platform called Rhodes.

Your job is to read the document and propose specific, actionable changes to the database. You have full knowledge of the current database state.

## Current Database State

### Entities (${(dbContext.entities as Array<{id: string; name: string; short_name: string | null; type: string; ein: string | null; formation_state: string; status: string; business_purpose: string | null}>).length} total)
${(dbContext.entities as Array<{id: string; name: string; short_name: string | null; type: string; ein: string | null; formation_state: string; status: string; business_purpose: string | null}>).map((e) => `- ${e.name}${e.short_name ? ` (aka "${e.short_name}")` : ''} (id: ${e.id}, type: ${e.type}, EIN: ${e.ein || 'N/A'}, state: ${e.formation_state}, status: ${e.status}${e.business_purpose ? `, purpose: ${e.business_purpose}` : ''})`).join('\n')}

### Directory Entries (${(dbContext.directory as Array<{id: string; name: string; type: string; email: string | null; aliases: string[] | null}>).length} total)
${(dbContext.directory as Array<{id: string; name: string; type: string; email: string | null; aliases: string[] | null}>).map((d) => `- ${d.name}${d.aliases && d.aliases.length > 0 ? ` (AKA: ${d.aliases.join(', ')})` : ''} (id: ${d.id}, type: ${d.type}, email: ${d.email || 'N/A'})`).join('\n')}

### Relationships (${(dbContext.relationships as unknown[]).length} total)
${(dbContext.relationships as Array<{id: string; type: string; from_entity_id: string | null; to_entity_id: string | null; description: string}>).map((r) => `- ${r.type}: ${r.from_entity_id} → ${r.to_entity_id} (${r.description || 'no description'})`).join('\n')}

### Registrations
${(dbContext.registrations as Array<{id: string; entity_id: string; jurisdiction: string; qualification_date: string | null; last_filing_date: string | null; state_id: string | null}>).map((r) => `- Entity ${r.entity_id}: ${r.jurisdiction} (registration_id: ${r.id}, qualification_date: ${r.qualification_date || 'N/A'}, last_filing_date: ${r.last_filing_date || 'N/A'}, state_id: ${r.state_id || 'N/A'})`).join('\n')}

### Managers
${(dbContext.managers as Array<{entity_id: string; name: string}>).map((m) => `- Entity ${m.entity_id}: ${m.name}`).join('\n')}

### Members
${(dbContext.members as Array<{entity_id: string; name: string}>).map((m) => `- Entity ${m.entity_id}: ${m.name}`).join('\n')}

### Trust Details
${(dbContext.trust_details as Array<{id: string; entity_id: string; trust_type: string; grantor_name: string | null}>).map((t) => `- Entity ${t.entity_id}: ${t.trust_type} trust, grantor: ${t.grantor_name || 'N/A'} (trust_detail_id: ${t.id})`).join('\n')}

### Trust Roles
${(dbContext.trust_roles as Array<{trust_detail_id: string; role: string; name: string}>).map((r) => `- Trust ${r.trust_detail_id}: ${r.role} = ${r.name}`).join('\n')}

### Cap Table
${(dbContext.cap_table as Array<{entity_id: string; investor_name: string | null; ownership_pct: number}>).map((c) => `- Entity ${c.entity_id}: ${c.investor_name || 'Unknown'} owns ${c.ownership_pct}%`).join('\n')}

### Partnership Representatives
${(dbContext.partnership_reps as Array<{entity_id: string; name: string}>).map((p) => `- Entity ${p.entity_id}: ${p.name}`).join('\n') || '(none)'}

### Entity Roles (VP, Controller, etc.)
${(dbContext.entity_roles as Array<{entity_id: string; role_title: string; name: string}>).map((r) => `- Entity ${r.entity_id}: ${r.role_title} = ${r.name}`).join('\n') || '(none)'}

### Compliance Obligations
${(dbContext.compliance_obligations as Array<{id: string; entity_id: string; name: string; jurisdiction: string; obligation_type: string; status: string; next_due_date: string | null; completed_at: string | null; rule_id: string}>).map((o) => `- Entity ${o.entity_id}: ${o.name} (${o.jurisdiction}) — status=${o.status}, due=${o.next_due_date || 'N/A'}${o.completed_at ? `, completed=${o.completed_at.split('T')[0]}` : ''}, obligation_id=${o.id}`).join('\n') || '(none)'}

## Response Format

You MUST respond with valid JSON only — no markdown, no explanation. Return an object with:

\`\`\`json
{
  "entity_id": "uuid of the primary existing entity this document is about, or null if proposing a new entity",
  "entity_match_confidence": "high | medium | low | none",
  "suggested_name": "A short, descriptive display name for this document",
  "summary": "A 2-3 sentence plain-text summary",
  "document_type": "the specific document type slug that best matches",
  "document_category": "formation | tax | investor | contracts | compliance | insurance | governance | other",
  "direction": "issued | received | null",
  "year": 2024,
  "actions": [
    {
      "action": "action_type",
      "data": { ... },
      "reason": "Why this change is being proposed",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "related_entities": [
    {
      "entity_id": "uuid of another existing entity mentioned in this document",
      "entity_name": "Name as it appears in document",
      "role": "counterparty | beneficiary | guarantor | member | manager | investor | investment_issuer | service_provider | related",
      "confidence": "high | medium | low",
      "reason": "Why this entity is associated"
    }
  ]
}
\`\`\`

### Document Type values (pick the most specific match, or propose a new slug if none fit):
${typeListStr}

If none of the above types fit, you may propose a new type by setting \`"is_new_document_type": true\` and providing \`"new_type_label"\` and \`"new_type_category"\` in the response.

IMPORTANT: Always set "entity_id" to the UUID of the existing entity this document primarily belongs to. Only set it to null if the document is about a brand new entity that needs to be created.

For "entity_match_confidence":
- "high": The document clearly names or references a specific existing entity (exact name match, EIN match, etc.)
- "medium": The document likely belongs to an entity but the match is inferred (partial name, address, context)
- "low": Multiple entities could match, or the match is a guess
- "none": Cannot determine which entity this document belongs to

### Action Data Schemas:

- **create_entity**: { "name": string, "type": "holding_company"|"investment_fund"|"operating_company"|"real_estate"|"special_purpose"|"management_company"|"trust"|"other", "ein": string|null, "formation_state": "XX", "formed_date": "YYYY-MM-DD"|null, "address": string|null, "registered_agent": string|null, "notes": string|null, "business_purpose": string|null }
- **update_entity**: { "entity_id": "uuid", "fields": { field: value, ... } }
- **create_relationship**: { "from_entity_id": "uuid"|null, "from_directory_id": "uuid"|null, "to_entity_id": "uuid"|null, "to_directory_id": "uuid"|null, "type": "profit_share"|"fixed_fee"|"management_fee"|"performance_fee"|"equity"|"loan"|"guarantee"|"service_agreement"|"license"|"lease"|"purchase_agreement"|"subscription_agreement"|"operating_agreement"|"trust_agreement"|"consulting"|"insurance"|"other", "description": string, "terms": string|null, "frequency": string|null, "annual_estimate": number|null }
- **add_member**: { "entity_id": "uuid", "name": string }
- **add_manager**: { "entity_id": "uuid", "name": string }
- **add_registration**: { "entity_id": "uuid", "jurisdiction": "XX", "qualification_date": "YYYY-MM-DD"|null, "last_filing_date": "YYYY-MM-DD"|null, "state_id": string|null }
- **update_registration**: { "registration_id": "uuid", "qualification_date": "YYYY-MM-DD"|null, "last_filing_date": "YYYY-MM-DD"|null, "state_id": string|null }
- **add_trust_role**: { "trust_detail_id": "uuid", "role": string, "name": string }
- **update_trust_details**: { "entity_id": "uuid", "trust_type": "revocable"|"irrevocable"|null, "trust_date": "YYYY-MM-DD"|null, "grantor_name": string|null, "situs_state": "XX"|null }
- **update_cap_table**: { "entity_id": "uuid", "investor_name": string, "investor_type": string, "units": number|null, "ownership_pct": number, "capital_contributed": number|null, "replaces_investor_name": string|null }
- **create_directory_entry**: { "name": string, "type": "individual"|"external_entity"|"trust", "email": string|null }
- **add_custom_field**: { "entity_id": "uuid", "label": string, "value": string }
- **add_partnership_rep**: { "entity_id": "uuid", "name": string }
- **add_role**: { "entity_id": "uuid", "role_title": string, "name": string }
- **complete_obligation**: { "obligation_id": "uuid", "completed_at": "YYYY-MM-DD", "payment_amount": number|null (in cents), "confirmation": string|null, "notes": string|null }

### Guidelines:
- Match entity names to existing entities by name when possible. Use the entity's UUID.
- If proposing a "create_entity" action AND other actions referencing the new entity, use "new_entity" as the entity_id placeholder.
- Match people/organizations to existing directory entries by name OR aliases.
- IMPORTANT: When adding members, managers, partnership reps, trust roles, cap table investors, or entity roles, ALWAYS also propose a "create_directory_entry" action for each person/organization that does NOT already exist in the directory. This ensures the directory stays complete. Check the directory entries list above — only create entries for names not already present (accounting for aliases).
- For dollar amounts in cap table, convert to cents (integer).
- Set confidence to "high" when clearly stated, "medium" when inferring, "low" when guessing.
- Don't propose changes that would duplicate existing data.
- For compliance filings: if entity has registration for that jurisdiction, use "update_registration". If not, use "add_registration".
- For required franchise tax payments: if a matching compliance obligation exists, use "complete_obligation". Also use "update_registration" to set last_filing_date.
- Do NOT propose actions for ELECTIVE/OPTIONAL tax payments (PTET, elective entity-level taxes).
- Do NOT use "add_custom_field" for state entity IDs — use state_id on registrations.

## Related Entities

Documents often reference multiple entities. Beyond the primary entity this document belongs to, identify any OTHER existing entities mentioned in the document and their role.

Return a "related_entities" array with entries for each additional entity referenced:
- "entity_id": UUID of the matching existing entity
- "entity_name": The name as it appears in the document
- "role": One of "counterparty", "beneficiary", "guarantor", "member", "manager", "investor", "investment_issuer", "service_provider", "related"
- "confidence": "high", "medium", or "low"
- "reason": Brief explanation of why this entity is associated

Common patterns:
- Service agreements / contracts: the other party is a "counterparty"
- Operating agreements naming entities as members: role is "member"
- K-1s issued to another entity: the recipient entity is "beneficiary"
- K-1s received FROM a fund/partnership: the issuing fund is "investment_issuer" (the document belongs to the RECIPIENT entity, not the fund)
- Loan documents with a guarantor entity: role is "guarantor"
- Fund documents naming an entity as LP/investor: role is "investor"
- Operating agreements naming an entity as manager: role is "manager"
- Invoices, engagement letters, or service contracts: the service provider is "service_provider"
- Any entity mentioned but role unclear: use "related"

Only include entities that exist in the provided entity list. Do not create proposed entities here — that's handled separately via the actions array.

## Termination Signal Detection

When reading a document, look for signals that a recurring document series is ending or has ended. Include a "termination_signals" array in your response:

\`\`\`json
{
  "termination_signals": [
    {
      "signal_type": "investment_wind_down | entity_dissolution | contract_termination | ownership_transfer",
      "entity_id": "uuid of the entity affected",
      "related_entity_name": "name of investment/counterparty if applicable",
      "related_entity_id": "uuid if matched to existing entity, null otherwise",
      "jurisdiction": "XX or null",
      "effective_date": "YYYY-MM-DD or null",
      "document_types_affected": ["k1", "distribution_notice"],
      "confidence": "high | medium | low",
      "reason": "Why this signals the end of a recurring document series"
    }
  ]
}
\`\`\`

Signal types to detect:
- **K-1s**: Check for "final K-1" checkbox/language, liquidating distributions, zero ending capital balance, or dissolution language. If present, emit an investment_wind_down signal.
- **Distribution notices**: Check for "final distribution" or "liquidating distribution" language.
- **Dissolution/termination documents**: Certificates of dissolution, articles of termination, withdrawal filings. Emit entity_dissolution with the relevant jurisdiction.
- **Contracts/agreements**: Termination notices, non-renewal notices, expiration dates that have passed. Emit contract_termination.
- **Sale/transfer documents**: Sale agreements, redemption agreements, assignment of interests. Emit ownership_transfer.

Only emit termination_signals when you have clear evidence in the document content. A low capital balance alone is not sufficient — look for explicit final/termination language or zero balances combined with distribution activity.

Set confidence to "high" when the document explicitly states finality (e.g., "Final K-1" checkbox marked, "Certificate of Dissolution" title). Set to "medium" when inferring from financial data (zero ending balance + liquidating distribution). Set to "low" when the signal is ambiguous.

If no termination signals are detected, return an empty array: "termination_signals": [].`;

  // Entity discovery section
  if (options?.entityDiscovery) {
    prompt += `

## Entity Discovery

This document is being processed with entity discovery ENABLED. If this document references entities that do NOT exist in the current database, you should propose creating them. Include a "proposed_entity" object in your response with the entity details:

\`\`\`json
{
  "proposed_entity": {
    "name": "Entity Name",
    "type": "holding_company",
    "ein": null,
    "formation_state": "DE",
    "confidence": "high"
  }
}
\`\`\`

Set entity_id to null when the document is about a proposed new entity.

### Ownership vs. Investment Distinction

CRITICAL: Only propose creating entities that the family/office OWNS or CONTROLS. Do NOT create entities for:
- **Investment counterparties**: Companies the family invested IN via SAFEs, convertible notes, stock purchases, LP interests. These are third-party companies — list them in "related_entities" with role "investment_issuer" instead.
- **Service providers**: Law firms, accountants, banks, fund administrators. List them in "related_entities" with role "service_provider" instead.
- **K-1 issuers**: Funds or partnerships that issued a K-1 TO one of the family's entities. The K-1 belongs to the RECIPIENT entity. The issuing fund goes in "related_entities" with role "investment_issuer".

Only propose "create_entity" for entities where the family is the FOUNDER, GRANTOR, SOLE MEMBER, or CONTROLLING PARTY — entities they set up and operate, not entities they transact with.

### Multi-Entity Creation Documents

Some legal instruments create or govern MULTIPLE separate entities within a single document. This is NOT the same as composite documents (multiple PDFs stapled together). This is ONE legal instrument that establishes multiple legal entities.

Common patterns:
- Trust instruments creating separate trusts per beneficiary (e.g., "Irrevocable Gift Trust" creating trusts fbo Child A, fbo Child B, fbo Child C — each is a separate trust entity with its own EIN and assets)
- Series LLC operating agreements establishing multiple series
- Family trust instruments with per-beneficiary sub-trusts
- Partnership agreements establishing multiple fund vehicles

Key signals:
- "each trust named for a person created hereunder"
- Separate distribution/default provisions per beneficiary or per series
- "fbo [Name]" or "for the benefit of [Name]" naming conventions
- "trusts created under this instrument" (plural)
- Series designations (Series A, Series B) under a master agreement

IMPORTANT: Before proposing new entities, CHECK THE EXISTING ENTITY LIST ABOVE carefully. If entities with matching or SIMILAR names already exist, do NOT propose creating them. Use FUZZY matching:
- "Doherty 2025 Irrevocable Gift Trust fbo Sean Doherty Jr" MATCHES "Doherty 2025 Irrevocable Trust fbo Sean Doherty, Jr." — these are the SAME entity
- Match on the beneficiary name (the "fbo [Name]" part) + entity type. Minor wording differences (e.g. "Gift Trust" vs "Trust", punctuation, suffixes like Jr/Jr.) do NOT make them different entities.
- When in doubt, USE THE EXISTING ENTITY rather than creating a duplicate.

If matching existing entities are found:
- Set "entity_id" to the first matching existing entity's UUID
- Include the other matching existing entities in "related_entities"
- Use "update_trust_details" and "add_trust_role" actions with the EXISTING entity UUIDs
- Do NOT include "create_entity" actions for entities that already exist
- Do NOT include "proposed_entities" entries for entities that already exist
- If the document contains a more precise or complete name than what's in the database (e.g. the DB has "Irrevocable Trust" but the document says "Irrevocable Gift Trust"), include an "update_entity" action to rename the existing entity to the correct legal name:
  { "action": "update_entity", "data": { "entity_id": "<existing UUID>", "fields": { "name": "Correct Legal Name From Document" } }, "confidence": "high" }

Only if the entities do NOT exist yet, then:
1. Set "entity_id" to null (the document doesn't belong to just one entity)
2. Include a SEPARATE "create_entity" action for EACH entity created by the document
3. Include ALL created entities in "proposed_entities" (an ARRAY, not singular):

\`\`\`json
{
  "entity_id": null,
  "proposed_entities": [
    { "name": "Trust fbo Child A", "type": "trust", "formation_state": "NV", "confidence": "high", "reason": "Section X creates separate trust for Child A" },
    { "name": "Trust fbo Child B", "type": "trust", "formation_state": "NV", "confidence": "high", "reason": "Section X creates separate trust for Child B" }
  ]
}
\`\`\`

Do NOT treat this as a composite document — the entire PDF is one legal instrument.
Each entity should have its own "create_entity" action AND a corresponding entry in "proposed_entities".
Also include "update_trust_details" and "add_trust_role" actions for EACH entity.
Use "new_entity_0", "new_entity_1", "new_entity_2" as entity_id placeholders (matching the order of create_entity actions).`;
  }

  // Composite detection section
  if (options?.compositeDetection) {
    prompt += `

## Composite Document Detection

A single PDF may contain multiple logical documents. This is common with tax packages that bundle federal returns, state returns, K-1 schedules, filing instructions, and extensions into one file.

If you detect multiple logical documents within a single PDF, set \`"is_composite": true\` and include a \`"sub_documents"\` array. Each sub-document should have its own type, jurisdiction, page range, and actions:

\`\`\`json
{
  "is_composite": true,
  "sub_documents": [
    {
      "document_type": "tax_return_1065",
      "document_category": "tax",
      "direction": "issued",
      "jurisdiction": "federal",
      "page_range": [7, 23],
      "suggested_name": "Entity — 2024 Federal Form 1065",
      "summary": "Federal partnership return...",
      "entity_id": "uuid",
      "year": 2024,
      "k1_recipient": null,
      "actions": [...]
    }
  ]
}
\`\`\`

Common composite patterns:
- Tax packages: filing instructions + federal return + state return(s) + K-1s
- K-1 bundles: multiple K-1s for different partners in one PDF
- Annual compliance packages: annual report + certificate of good standing + registered agent docs

For K-1 sub-documents:
- Set "k1_recipient" to the partner/shareholder/beneficiary name
- IMPORTANT: Match the K-1 recipient against the EXISTING ENTITY LIST above. If a recipient matches an existing entity (by name or fuzzy match), set "entity_id" to that entity's UUID. The K-1 document should be associated with the RECIPIENT entity, not the filing entity.
- If the recipient doesn't match any existing entity, set "entity_id" to null

For ALL sub-documents: set "entity_id" by matching the relevant entity from the EXISTING ENTITY LIST. For the main return, this is the filing entity. For K-1s, this is the recipient entity. For state returns, this is the filing entity. Never leave "entity_id" null if the entity exists in the list above.`;
  }

  return prompt;
}

// --- Extraction Result ---

export interface RelatedEntityRef {
  entity_id: string;
  entity_name: string;
  role: 'counterparty' | 'beneficiary' | 'guarantor' | 'member' | 'manager' | 'investor' | 'investment_issuer' | 'service_provider' | 'related';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface TerminationSignal {
  signal_type: 'investment_wind_down' | 'entity_dissolution' | 'contract_termination' | 'ownership_transfer';
  entity_id: string;
  related_entity_name: string | null;
  related_entity_id: string | null;
  jurisdiction: string | null;
  effective_date: string | null;
  document_types_affected: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface ExtractionResult {
  entity_id: string | null;
  entity_match_confidence: 'high' | 'medium' | 'low' | 'none';
  suggested_name: string | null;
  summary: string | null;
  document_type: string | null;
  document_category: string | null;
  direction: string | null;
  year: number | null;
  actions: unknown[];
  confidence: number | null;
  is_composite: boolean;
  sub_documents: SubDocument[];
  proposed_entity: Record<string, unknown> | null;           // singular (backward compat)
  proposed_entities: Array<Record<string, unknown>>;          // multi-entity creation documents
  is_new_document_type: boolean;
  new_type_label: string | null;
  new_type_category: string | null;
  tokens_used: number;
  related_entities: RelatedEntityRef[];
  termination_signals: TerminationSignal[];
}

export interface SubDocument {
  document_type: string;
  document_category: string;
  direction: string | null;
  jurisdiction: string | null;
  page_range: [number, number] | null;
  suggested_name: string;
  summary: string;
  entity_id: string | null;
  year: number | null;
  k1_recipient: string | null;
  actions: unknown[];
}

/**
 * Extract document content using Claude API.
 * This is the shared extraction function used by both the pipeline worker
 * and the legacy /api/documents/[id]/process route.
 */
export async function extractDocument(
  fileData: Blob | Buffer,
  mimeType: string | null,
  docName: string,
  docType: string | null,
  year: number | null,
  dbContext: Record<string, unknown[]>,
  options?: {
    entityDiscovery?: boolean;
    compositeDetection?: boolean;
    notes?: string;
  }
): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("AI processing not configured — missing ANTHROPIC_API_KEY");
  }

  const systemPrompt = await buildSystemPrompt(dbContext, {
    entityDiscovery: options?.entityDiscovery,
    compositeDetection: options?.compositeDetection,
  });

  const isPdf = mimeType === "application/pdf";
  const isImage = mimeType?.startsWith("image/");

  let buffer: Buffer;
  if (fileData instanceof Buffer) {
    buffer = fileData;
  } else {
    buffer = Buffer.from(await (fileData as Blob).arrayBuffer());
  }

  let userContent: unknown[];

  if (isPdf) {
    const analysis = await analyzePdf(buffer, docType);
    userContent = await buildPdfContent(buffer, analysis, docName, docType, year);
  } else if (isImage) {
    const base64 = buffer.toString("base64");
    userContent = [
      {
        type: "image",
        source: { type: "base64", media_type: mimeType, data: base64 },
      },
      {
        type: "text",
        text: `Analyze this ${(docType || "unknown").replace(/_/g, " ")} document image and propose database changes. The document is named "${docName}"${year ? ` and is from year ${year}` : ""}.${options?.notes ? ` Notes: ${options.notes}` : ""}`,
      },
    ];
  } else {
    // Text-based file
    const text = buffer.toString("utf-8");
    userContent = [
      {
        type: "text",
        text: `Analyze this ${(docType || "unknown").replace(/_/g, " ")} document and propose database changes.\n\nDocument name: "${docName}"${year ? `\nYear: ${year}` : ""}${options?.notes ? `\nNotes: ${options.notes}` : ""}\n\nDocument content:\n---\n${text}\n---`,
      },
    ];
  }

  const maxTokens = options?.compositeDetection ? 8192 : 4096;

  // 4-minute timeout — leaves room for error handling before Vercel's maxDuration
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);

  let claudeResponse: Response;
  try {
    claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("AI processing timed out — the document may be too large. Try uploading individual sections.");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!claudeResponse.ok) {
    const errorText = await claudeResponse.text();
    console.error("Claude API error:", claudeResponse.status, errorText);
    let detail = "AI processing failed";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed?.error?.message || detail;
    } catch {
      /* use default */
    }
    throw new Error(detail);
  }

  const claudeResult = await claudeResponse.json();
  const responseText = claudeResult.content?.[0]?.text || "{}";
  const tokensUsed =
    (claudeResult.usage?.input_tokens || 0) +
    (claudeResult.usage?.output_tokens || 0);

  // Parse response
  const cleanJson = responseText
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleanJson);
  } catch {
    console.error("Failed to parse Claude response:", responseText);
    parsed = {};
  }

  const VALID_MATCH_CONFIDENCES = ['high', 'medium', 'low', 'none'] as const;
  const rawMatchConf = parsed.entity_match_confidence as string;
  const entityMatchConfidence: ExtractionResult['entity_match_confidence'] =
    VALID_MATCH_CONFIDENCES.includes(rawMatchConf as typeof VALID_MATCH_CONFIDENCES[number])
      ? (rawMatchConf as ExtractionResult['entity_match_confidence'])
      : (parsed.entity_id ? 'high' : 'none');

  const result: ExtractionResult = {
    entity_id: (parsed.entity_id as string) || null,
    entity_match_confidence: entityMatchConfidence,
    suggested_name: (parsed.suggested_name as string) || null,
    summary: (parsed.summary as string) || null,
    document_type: (parsed.document_type as string) || null,
    document_category: (parsed.document_category as string) || null,
    direction: (parsed.direction as string) || null,
    year: typeof parsed.year === "number" ? parsed.year : null,
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    confidence: computeConfidence(Array.isArray(parsed.actions) ? parsed.actions : []),
    is_composite: !!parsed.is_composite,
    sub_documents: Array.isArray(parsed.sub_documents)
      ? (parsed.sub_documents as SubDocument[])
      : [],
    proposed_entity: (parsed.proposed_entity as Record<string, unknown>) || null,
    proposed_entities: Array.isArray(parsed.proposed_entities)
      ? (parsed.proposed_entities as Array<Record<string, unknown>>)
      : parsed.proposed_entity
        ? [parsed.proposed_entity as Record<string, unknown>]
        : [],
    is_new_document_type: !!parsed.is_new_document_type,
    new_type_label: (parsed.new_type_label as string) || null,
    new_type_category: (parsed.new_type_category as string) || null,
    tokens_used: tokensUsed,
    related_entities: Array.isArray(parsed.related_entities)
      ? (parsed.related_entities as RelatedEntityRef[]).filter(
          (r) => r.entity_id && r.entity_id !== (parsed.entity_id as string)
        )
      : [],
    termination_signals: Array.isArray(parsed.termination_signals)
      ? (parsed.termination_signals as TerminationSignal[])
      : [],
  };

  return result;
}
