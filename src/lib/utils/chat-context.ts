import { createAdminClient } from "@/lib/supabase/admin";
import { Redis } from "@upstash/redis";

const CACHE_TTL_SEC = 300; // 5 minutes

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

export async function buildChatContext(orgId: string) {
  const client = getRedis();
  const cacheKey = `chat-ctx:${orgId}`;

  if (client) {
    try {
      const cached = await client.get<string>(cacheKey);
      if (cached) return cached;
    } catch {
      // Redis unavailable, fall through to rebuild
    }
  }
  const supabase = createAdminClient();

  // Step 1: Fetch org-scoped entities first to get entity IDs for sub-table filtering
  const entitiesRes = await supabase.from("entities").select("*").eq("organization_id", orgId).order("name");
  const entities = entitiesRes.data || [];
  const entityIds = entities.map(e => e.id);

  // Step 2: Fetch remaining root tables and sub-entity tables scoped to org's entities
  const [
    directoryRes,
    relationshipsRes,
    registrationsRes,
    managersRes,
    membersRes,
    trustDetailsRes,
    trustRolesRes,
    capTableRes,
    partnershipRepsRes,
    entityRolesRes,
    documentsRes,
    complianceRes,
  ] = await Promise.all([
    supabase.from("directory_entries").select("*").eq("organization_id", orgId).order("name"),
    supabase.from("relationships").select("*").eq("organization_id", orgId),
    entityIds.length > 0
      ? supabase.from("entity_registrations").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase.from("entity_managers").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase.from("entity_members").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase.from("trust_details").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    // trust_roles fetched separately after trust_details (needs trust_detail IDs)
    Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase.from("cap_table_entries").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase.from("entity_partnership_reps").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase.from("entity_roles").select("*").in("entity_id", entityIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("documents").select("id, name, document_type, document_category, year, entity_id, ai_extracted, ai_extraction, created_at").eq("organization_id", orgId).is("deleted_at", null).order("created_at", { ascending: false }),
    entityIds.length > 0
      ? supabase.from("compliance_obligations").select("*").in("entity_id", entityIds).order("next_due_date", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const directory = directoryRes.data || [];
  const relationships = relationshipsRes.data || [];
  const registrations = registrationsRes.data || [];
  const managers = managersRes.data || [];
  const members = membersRes.data || [];
  const trustDetails = trustDetailsRes.data || [];
  // Fetch trust_roles scoped by the trust_detail IDs from this org's entities
  const trustDetailIds = (trustDetailsRes.data || []).map(t => t.id);
  const trustRolesActual = trustDetailIds.length > 0
    ? await supabase.from("trust_roles").select("*").in("trust_detail_id", trustDetailIds)
    : { data: [], error: null };
  const trustRoles = trustRolesActual.data || [];
  const capTable = capTableRes.data || [];
  const partnershipReps = partnershipRepsRes.data || [];
  const entityRoles = entityRolesRes.data || [];
  const documents = documentsRes.data || [];
  const complianceObligations = complianceRes.data || [];

  // Fetch document completeness expectations
  const expectationsRes = entityIds.length > 0
    ? await supabase
        .from("entity_document_expectations")
        .select("entity_id, document_type, is_satisfied, is_not_applicable, is_suggestion, is_required")
        .in("entity_id", entityIds)
        .eq("is_not_applicable", false)
        .eq("is_suggestion", false)
    : { data: [], error: null };
  const allExpectations = expectationsRes.data || [];

  // Build entity name lookup
  const entityNames: Record<string, string> = {};
  for (const e of entities) entityNames[e.id] = e.name;
  const dirNames: Record<string, string> = {};
  for (const d of directory) dirNames[d.id] = d.name;

  let context = `You are an AI assistant for Rhodes, a family office entity management platform. You have full knowledge of all entities, relationships, directory entries, compliance filings, and financial data in the system.

When referencing entities, always use their exact name as it appears in the database so the UI can create clickable links.
When referencing documents, use the document name and include the year if available (e.g., "K-1 Tax Document (2023)").

## Entities (${entities.length} total)\n\n`;

  for (const entity of entities) {
    const entityRegs = registrations.filter(r => r.entity_id === entity.id);
    const entityManagers = managers.filter(m => m.entity_id === entity.id);
    const entityMembers = members.filter(m => m.entity_id === entity.id);
    const entityPartnershipReps = partnershipReps.filter(p => p.entity_id === entity.id);
    const entityEntityRoles = entityRoles.filter(r => r.entity_id === entity.id);
    const entityTrust = trustDetails.find(t => t.entity_id === entity.id);
    const entityCapTable = capTable.filter(c => c.entity_id === entity.id);

    context += `### ${entity.name}\n`;
    context += `- Type: ${entity.type.replace(/_/g, ' ')}, Status: ${entity.status}\n`;
    context += `- EIN: ${entity.ein || 'N/A'}, Formation State: ${entity.formation_state}`;
    if (entity.formed_date) context += `, Formed: ${entity.formed_date}`;
    context += '\n';
    if (entity.address) context += `- Address: ${entity.address}\n`;
    if (entity.registered_agent) context += `- Registered Agent: ${entity.registered_agent}\n`;

    if (entityRegs.length > 0) {
      context += `- Registered in: ${entityRegs.map(r => r.jurisdiction).join(', ')}\n`;
    }
    if (entityManagers.length > 0) {
      context += `- Managers: ${entityManagers.map(m => m.name).join(', ')}\n`;
    }
    if (entityMembers.length > 0) {
      context += `- Members: ${entityMembers.map(m => m.name).join(', ')}\n`;
    }
    if (entityPartnershipReps.length > 0) {
      context += `- Partnership Representatives: ${entityPartnershipReps.map(p => p.name).join(', ')}\n`;
    }
    if (entityEntityRoles.length > 0) {
      context += `- Roles: ${entityEntityRoles.map(r => `${r.role_title}: ${r.name}`).join('; ')}\n`;
    }
    if (entity.business_purpose) {
      context += `- Business Purpose: ${entity.business_purpose}\n`;
    }
    if (entityTrust) {
      context += `- Trust Type: ${entityTrust.trust_type}`;
      if (entityTrust.grantor_name) context += `, Grantor: ${entityTrust.grantor_name}`;
      if (entityTrust.situs_state) context += `, Situs: ${entityTrust.situs_state}`;
      context += '\n';

      const roles = trustRoles.filter(r => r.trust_detail_id === entityTrust.id);
      if (roles.length > 0) {
        context += `- Trust Roles: ${roles.map(r => `${r.role.replace(/_/g, ' ')}: ${r.name}`).join('; ')}\n`;
      }
    }
    if (entityCapTable.length > 0) {
      context += `- Cap Table: ${entityCapTable.map(c => `${c.investor_name || 'Unknown'} (${c.ownership_pct}%)`).join(', ')}\n`;
    }

    const entityObligations = complianceObligations.filter(o => o.entity_id === entity.id);
    if (entityObligations.length > 0) {
      context += `- Compliance Obligations:\n`;
      for (const ob of entityObligations) {
        context += `  - ${ob.name} (${ob.jurisdiction}): status=${ob.status}, due=${ob.next_due_date || 'N/A'}`;
        if (ob.completed_at) context += `, last_completed=${ob.completed_at.split('T')[0]}`;
        if (ob.payment_amount) context += `, fee=$${(ob.payment_amount / 100).toFixed(2)}`;
        context += `\n`;
      }
    }

    // Document completeness
    const entityExpectations = allExpectations.filter(e => e.entity_id === entity.id);
    if (entityExpectations.length > 0) {
      const satisfied = entityExpectations.filter(e => e.is_satisfied).length;
      const total = entityExpectations.length;
      const missing = entityExpectations.filter(e => !e.is_satisfied);
      context += `- Document Completeness: ${satisfied}/${total} on file`;
      if (missing.length > 0) {
        const missingNames = missing.map(e => e.document_type.replace(/_/g, ' ')).join(', ');
        context += ` (missing: ${missingNames})`;
      }
      context += '\n';
    }

    context += '\n';
  }

  context += `## Directory (${directory.length} entries)\n\n`;
  for (const entry of directory) {
    context += `- ${entry.name}`;
    if (entry.aliases && entry.aliases.length > 0) context += ` (AKA: ${entry.aliases.join(', ')})`;
    context += ` (${entry.type})`;
    if (entry.email) context += ` — ${entry.email}`;
    if (entry.phone) context += ` — ${entry.phone}`;
    context += '\n';
  }

  context += `\n## Relationships (${relationships.length} total)\n\n`;
  for (const rel of relationships) {
    const fromName = rel.from_entity_id ? entityNames[rel.from_entity_id] : (rel.from_directory_id ? dirNames[rel.from_directory_id] : 'Unknown');
    const toName = rel.to_entity_id ? entityNames[rel.to_entity_id] : (rel.to_directory_id ? dirNames[rel.to_directory_id] : 'Unknown');
    context += `- ${rel.type.replace(/_/g, ' ')}: ${fromName} → ${toName}`;
    if (rel.description) context += ` (${rel.description})`;
    if (rel.status) context += ` [${rel.status}]`;
    if (rel.annual_estimate) context += ` — $${(rel.annual_estimate / 100).toLocaleString()}/yr`;
    context += '\n';
  }

  if (documents.length > 0) {
    context += `\n## Documents (${documents.length} total)\n\n`;
    for (const doc of documents) {
      const entName = doc.entity_id ? entityNames[doc.entity_id] : null;
      const extraction = doc.ai_extraction as { summary?: string } | null;
      const summary = extraction?.summary;
      context += `- [doc:${doc.id}] ${doc.name}`;
      if (doc.document_category) context += ` [${doc.document_category}]`;
      if (entName) context += ` — ${entName}`;
      if (doc.year) context += ` (${doc.year})`;
      if (summary) context += ` — ${summary}`;
      context += '\n';
    }
  }

  // Fetch inferred patterns and pending suggestions
  const [patternsRes, suggestionsRes] = await Promise.all([
    supabase.from("org_document_patterns").select("pattern_type, document_type, description, confidence, entity_coverage, is_active").eq("organization_id", orgId).eq("is_active", true).order("confidence", { ascending: false }),
    entityIds.length > 0
      ? supabase.from("entity_document_expectations").select("entity_id, document_type, confidence, inference_reason").in("entity_id", entityIds).eq("is_suggestion", true).eq("is_not_applicable", false)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const patterns = patternsRes.data || [];
  const suggestions = suggestionsRes.data || [];

  if (patterns.length > 0) {
    context += `\n## Inferred Patterns\n\n`;
    for (const p of patterns) {
      context += `- ${p.document_type.replace(/_/g, ' ')}: ${p.description} (${Math.round(p.confidence * 100)}% confidence)\n`;
    }
  }

  if (suggestions.length > 0) {
    context += `\n## Pending Suggestions\n\n`;
    // Group by entity
    const byEntity = new Map<string, typeof suggestions>();
    for (const s of suggestions) {
      const arr = byEntity.get(s.entity_id) || [];
      arr.push(s);
      byEntity.set(s.entity_id, arr);
    }
    for (const [eid, items] of byEntity) {
      const eName = entityNames[eid] || 'Unknown';
      context += `- ${eName}: ${items.map(i => `${i.document_type.replace(/_/g, ' ')} (${Math.round((i.confidence || 0) * 100)}%)`).join(', ')}\n`;
    }
  }

  context += `\nAnswer questions about entities, relationships, compliance, organizational structure, and documents. Be specific and reference entity names exactly as they appear. If you don't know something, say so rather than guessing. Format your responses with clear structure using markdown.

When answering questions about documents or referencing specific information from documents, ALWAYS cite your sources using this exact format:

[Document Name](doc:DOCUMENT_UUID)

For example:
- The ownership split is defined in [Doherty Holdings Operating Agreement](doc:abc-123-def) (page 12, section 4.3)
- According to the [2024 K-1 for Fund II](doc:xyz-789), the ordinary business income was $45,230

Always include the document UUID from the [doc:UUID] prefix in the document list above. If you know the page number, include it as text after the link. When listing multiple documents, format each as a clickable reference.`;

  if (client) {
    try {
      await client.set(cacheKey, context, { ex: CACHE_TTL_SEC });
    } catch {
      // Redis unavailable, context still returned normally
    }
  }

  return context;
}
