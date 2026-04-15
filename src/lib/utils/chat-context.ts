import { createAdminClient } from "@/lib/supabase/admin";
import { Redis } from "@upstash/redis";

const SAFETY_TTL_SEC = 86400; // 24 hours — fallback if event-driven invalidation misses a mutation

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

/**
 * Invalidate all per-org context caches. Called from mutation routes
 * (entities, investments, transactions, directory, etc.) so that the next
 * extraction or chat call rebuilds context from the live database.
 *
 * Without this, the extraction model and the chat model see a snapshot of
 * org state from up to 24 hours ago — which means newly-created investments
 * are invisible, deleted investments still appear, and any subtle change to
 * the org state can cause the model to return inconsistent results between
 * runs of the same input.
 *
 * Safe to call from any route handler — silently no-ops when Redis isn't
 * configured. Failures are logged but never thrown.
 */
export async function invalidateOrgCaches(orgId: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    await Promise.all([
      client.del(`chat-ctx:${orgId}`),
      client.del(`extraction-ctx:${orgId}`),
    ]);
  } catch (err) {
    console.error(`[invalidateOrgCaches] Failed to clear Redis cache for org ${orgId}:`, err);
  }
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
    _trustRolesRes,
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

    context += `### ${entity.name} (id: ${entity.id})\n`;
    if (entity.aliases && entity.aliases.length > 0) context += `- AKA: ${entity.aliases.join(', ')}\n`;
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

  // Fetch investment data
  const investmentsRes = await supabase
    .from("investments")
    .select("id, name, short_name, investment_type, status, description, date_invested, date_exited, preferred_return_pct, preferred_return_basis")
    .eq("organization_id", orgId)
    .order("name");
  const investments = investmentsRes.data || [];

  if (investments.length > 0) {
    const investmentIds = investments.map(i => i.id);

    // Fetch investors for all investments
    const investorsRes = await supabase
      .from("investment_investors")
      .select("id, investment_id, entity_id, capital_pct, profit_pct, committed_capital, is_active")
      .in("investment_id", investmentIds)
      .eq("is_active", true);
    const investors = investorsRes.data || [];

    // Fetch co-investors
    const coInvestorsRes = await supabase
      .from("investment_co_investors")
      .select("investment_id, directory_entry_id, role, capital_pct, profit_pct")
      .in("investment_id", investmentIds);
    const coInvestors = coInvestorsRes.data || [];

    // Fetch allocations for all investors
    const investorIds = investors.map(i => i.id);
    const allocationsRes = investorIds.length > 0
      ? await supabase
          .from("investment_allocations")
          .select("investment_investor_id, member_directory_id, member_entity_id, allocation_pct, is_active")
          .in("investment_investor_id", investorIds)
          .eq("is_active", true)
      : { data: [], error: null };
    const allocations = allocationsRes.data || [];

    // Fetch recent transactions (parent-level only, last 50)
    const transactionsRes = investorIds.length > 0
      ? await supabase
          .from("investment_transactions")
          .select("id, investment_investor_id, transaction_type, amount, transaction_date, description")
          .in("investment_investor_id", investorIds)
          .is("parent_transaction_id", null)
          .order("transaction_date", { ascending: false })
          .limit(50)
      : { data: [], error: null };
    const transactions = transactionsRes.data || [];

    context += `\n## Investments (${investments.length} total)\n\n`;
    for (const inv of investments) {
      context += `### ${inv.name} (id: ${inv.id})\n`;
      context += `- Type: ${inv.investment_type.replace(/_/g, ' ')}, Status: ${inv.status}\n`;
      if (inv.date_invested) context += `- Date Invested: ${inv.date_invested}\n`;
      if (inv.date_exited) context += `- Date Exited: ${inv.date_exited}\n`;
      if (inv.preferred_return_pct) context += `- Preferred Return: ${inv.preferred_return_pct}%${inv.preferred_return_basis ? ` on ${inv.preferred_return_basis.replace(/_/g, ' ')}` : ''}\n`;
      if (inv.description) context += `- Description: ${inv.description}\n`;

      // Investors. Each line includes the entity_id so the model has a real
      // UUID to put into action.parent_entity_id (otherwise it hallucinates).
      const invInvestors = investors.filter(ii => ii.investment_id === inv.id);
      if (invInvestors.length > 0) {
        context += `- Investors:\n`;
        for (const ii of invInvestors) {
          const eName = entityNames[ii.entity_id] || 'Unknown';
          context += `  - ${eName} (entity_id: ${ii.entity_id})`;
          if (ii.capital_pct != null) context += ` (Capital: ${ii.capital_pct}%`;
          if (ii.profit_pct != null) context += `, Profit: ${ii.profit_pct}%`;
          if (ii.capital_pct != null) context += ')';
          context += '\n';
        }
      }

      // Internal allocations per investor
      for (const ii of invInvestors) {
        const invAllocs = allocations.filter(a => a.investment_investor_id === ii.id);
        if (invAllocs.length > 0) {
          const eName = entityNames[ii.entity_id] || 'Unknown';
          context += `- Internal Allocations (${eName}):\n`;
          for (const alloc of invAllocs) {
            const memberName = alloc.member_entity_id
              ? (entityNames[alloc.member_entity_id] || 'Unknown entity')
              : alloc.member_directory_id
                ? (dirNames[alloc.member_directory_id] || 'Unknown')
                : 'Unknown';
            context += `  - ${memberName}: ${alloc.allocation_pct}%`;
            if (ii.committed_capital != null) {
              context += ` ($${Math.round(Number(alloc.allocation_pct) / 100 * Number(ii.committed_capital)).toLocaleString()})`;
            }
            context += '\n';
          }
        }
      }

      // Co-investors
      const invCoInvestors = coInvestors.filter(c => c.investment_id === inv.id);
      if (invCoInvestors.length > 0) {
        context += `- Co-investors:\n`;
        for (const ci of invCoInvestors) {
          const ciName = dirNames[ci.directory_entry_id] || 'Unknown';
          context += `  - ${ciName} [${ci.role}]`;
          if (ci.capital_pct != null) context += ` (Capital: ${ci.capital_pct}%`;
          if (ci.profit_pct != null) context += `, Profit: ${ci.profit_pct}%`;
          if (ci.capital_pct != null) context += ')';
          context += '\n';
        }
      }

      // Transactions
      const invTxns = transactions.filter(t => invInvestors.some(ii => ii.id === t.investment_investor_id));
      if (invTxns.length > 0) {
        context += `- Recent Transactions:\n`;
        for (const txn of invTxns.slice(0, 5)) {
          const investorEntity = invInvestors.find(ii => ii.id === txn.investment_investor_id);
          const investorName = investorEntity ? (entityNames[investorEntity.entity_id] || '') : '';
          context += `  - ${txn.transaction_date}: ${txn.transaction_type} $${Number(txn.amount).toLocaleString()}`;
          if (investorName) context += ` (${investorName})`;
          if (txn.description) context += ` — ${txn.description}`;
          context += '\n';
        }
      }

      context += '\n';
    }
  }

  // Fetch inferred patterns, pending suggestions, and termination signals
  const [patternsRes, suggestionsRes, signalsRes] = await Promise.all([
    supabase.from("org_document_patterns").select("pattern_type, document_type, description, confidence, entity_coverage, is_active").eq("organization_id", orgId).eq("is_active", true).order("confidence", { ascending: false }),
    entityIds.length > 0
      ? supabase.from("entity_document_expectations").select("entity_id, document_type, confidence, inference_reason").in("entity_id", entityIds).eq("is_suggestion", true).eq("is_not_applicable", false)
      : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0
      ? supabase.from("entity_recurrence_signals").select("entity_id, signal_type, related_entity_name, document_types_affected, effective_date, reason").in("entity_id", entityIds).eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const patterns = patternsRes.data || [];
  const suggestions = suggestionsRes.data || [];
  const signals = signalsRes.data || [];

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

  if (signals.length > 0) {
    context += `\n## Termination Signals\n\nThese signals indicate that recurring document series have ended or are ending:\n\n`;
    for (const s of signals) {
      const eName = entityNames[s.entity_id] || 'Unknown';
      const types = s.document_types_affected.map((t: string) => t.replace(/_/g, ' ')).join(', ');
      context += `- ${eName}: ${s.signal_type.replace(/_/g, ' ')}`;
      if (s.related_entity_name) context += ` (${s.related_entity_name})`;
      context += ` — affects ${types}`;
      if (s.effective_date) context += `, effective ${s.effective_date}`;
      context += `. ${s.reason}\n`;
    }
  }

  context += `\nAnswer questions about entities, investments, transactions, relationships, compliance, organizational structure, and documents. Be specific and reference entity names exactly as they appear. If you don't know something, say so rather than guessing.

IMPORTANT: Be concise. For factual questions (allocations, ownership, dates, amounts), give a direct answer first — a short sentence or a simple list. Only add explanation if the user asks for it or the answer requires clarification. Do not repeat information the user already knows or explain concepts they understand.

When answering questions about documents or referencing specific information from documents, ALWAYS cite your sources using this exact format:

[Document Name](doc:DOCUMENT_UUID)

For example:
- The ownership split is defined in [Doherty Holdings Operating Agreement](doc:abc-123-def) (page 12, section 4.3)
- According to the [2024 K-1 for Fund II](doc:xyz-789), the ordinary business income was $45,230

Always include the document UUID from the [doc:UUID] prefix in the document list above. If you know the page number, include it as text after the link. When listing multiple documents, format each as a clickable reference.`;

  if (client) {
    try {
      await client.set(cacheKey, context, { ex: SAFETY_TTL_SEC });
    } catch {
      // Redis unavailable, context still returned normally
    }
  }

  return context;
}

/**
 * Build extraction context — structural org data for Tier 2 extraction.
 * Same as buildChatContext but excludes documents, patterns, suggestions, signals,
 * and the chat instruction block. Used as the system prompt for extraction.
 * Cached in Redis at `extraction-ctx:${orgId}` with safety TTL.
 */
export async function buildExtractionContext(orgId: string): Promise<string> {
  const client = getRedis();
  const cacheKey = `extraction-ctx:${orgId}`;

  if (client) {
    try {
      const cached = await client.get<string>(cacheKey);
      if (cached) return cached;
    } catch { /* Redis unavailable */ }
  }

  const supabase = createAdminClient();

  const entitiesRes = await supabase.from("entities").select("*").eq("organization_id", orgId).order("name");
  const entities = entitiesRes.data || [];
  const entityIds = entities.map(e => e.id);

  const [
    directoryRes, relationshipsRes, registrationsRes, managersRes, membersRes,
    trustDetailsRes, _trustRolesRes, capTableRes, partnershipRepsRes, entityRolesRes,
    complianceRes,
  ] = await Promise.all([
    supabase.from("directory_entries").select("*").eq("organization_id", orgId).order("name"),
    supabase.from("relationships").select("*").eq("organization_id", orgId),
    entityIds.length > 0 ? supabase.from("entity_registrations").select("*").in("entity_id", entityIds) : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0 ? supabase.from("entity_managers").select("*").in("entity_id", entityIds) : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0 ? supabase.from("entity_members").select("*").in("entity_id", entityIds) : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0 ? supabase.from("trust_details").select("*").in("entity_id", entityIds) : Promise.resolve({ data: [], error: null }),
    Promise.resolve({ data: [], error: null }),
    entityIds.length > 0 ? supabase.from("cap_table_entries").select("*").in("entity_id", entityIds) : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0 ? supabase.from("entity_partnership_reps").select("*").in("entity_id", entityIds) : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0 ? supabase.from("entity_roles").select("*").in("entity_id", entityIds) : Promise.resolve({ data: [], error: null }),
    entityIds.length > 0 ? supabase.from("compliance_obligations").select("*").in("entity_id", entityIds).order("next_due_date", { ascending: true }) : Promise.resolve({ data: [], error: null }),
  ]);

  const directory = directoryRes.data || [];
  const relationships = relationshipsRes.data || [];
  const registrations = registrationsRes.data || [];
  const managers = managersRes.data || [];
  const members = membersRes.data || [];
  const trustDetails = trustDetailsRes.data || [];
  const trustDetailIds = trustDetails.map(t => t.id);
  const trustRolesActual = trustDetailIds.length > 0
    ? await supabase.from("trust_roles").select("*").in("trust_detail_id", trustDetailIds)
    : { data: [], error: null };
  const trustRoles = trustRolesActual.data || [];
  const capTable = capTableRes.data || [];
  const partnershipReps = partnershipRepsRes.data || [];
  const entityRoles = entityRolesRes.data || [];
  const complianceObligations = complianceRes.data || [];

  const entityNames: Record<string, string> = {};
  for (const e of entities) entityNames[e.id] = e.name;
  const dirNames: Record<string, string> = {};
  for (const d of directory) dirNames[d.id] = d.name;

  let context = `## Entities (${entities.length} total)\n\n`;

  for (const entity of entities) {
    const entityRegs = registrations.filter(r => r.entity_id === entity.id);
    const entityManagers = managers.filter(m => m.entity_id === entity.id);
    const entityMembers = members.filter(m => m.entity_id === entity.id);
    const entityPartnershipReps = partnershipReps.filter(p => p.entity_id === entity.id);
    const entityEntityRoles = entityRoles.filter(r => r.entity_id === entity.id);
    const entityTrust = trustDetails.find(t => t.entity_id === entity.id);
    const entityCapTable = capTable.filter(c => c.entity_id === entity.id);

    context += `### ${entity.name} (id: ${entity.id})\n`;
    if (entity.aliases && entity.aliases.length > 0) context += `- AKA: ${entity.aliases.join(', ')}\n`;
    context += `- Type: ${entity.type.replace(/_/g, ' ')}, Status: ${entity.status}\n`;
    context += `- EIN: ${entity.ein || 'N/A'}, Formation State: ${entity.formation_state}`;
    if (entity.formed_date) context += `, Formed: ${entity.formed_date}`;
    context += '\n';
    if (entity.address) context += `- Address: ${entity.address}\n`;
    if (entity.registered_agent) context += `- Registered Agent: ${entity.registered_agent}\n`;
    if (entityRegs.length > 0) context += `- Registered in: ${entityRegs.map(r => r.jurisdiction).join(', ')}\n`;
    if (entityManagers.length > 0) context += `- Managers: ${entityManagers.map(m => m.name).join(', ')}\n`;
    if (entityMembers.length > 0) context += `- Members: ${entityMembers.map(m => m.name).join(', ')}\n`;
    if (entityPartnershipReps.length > 0) context += `- Partnership Representatives: ${entityPartnershipReps.map(p => p.name).join(', ')}\n`;
    if (entityEntityRoles.length > 0) context += `- Roles: ${entityEntityRoles.map(r => `${r.role_title}: ${r.name}`).join('; ')}\n`;
    if (entity.business_purpose) context += `- Business Purpose: ${entity.business_purpose}\n`;
    if (entityTrust) {
      context += `- Trust Type: ${entityTrust.trust_type}`;
      if (entityTrust.grantor_name) context += `, Grantor: ${entityTrust.grantor_name}`;
      if (entityTrust.situs_state) context += `, Situs: ${entityTrust.situs_state}`;
      context += '\n';
      const roles = trustRoles.filter(r => r.trust_detail_id === entityTrust.id);
      if (roles.length > 0) context += `- Trust Roles: ${roles.map(r => `${r.role.replace(/_/g, ' ')}: ${r.name}`).join('; ')}\n`;
    }
    if (entityCapTable.length > 0) context += `- Cap Table: ${entityCapTable.map(c => `${c.investor_name || 'Unknown'} (${c.ownership_pct}%)`).join(', ')}\n`;
    if (complianceObligations.filter(o => o.entity_id === entity.id).length > 0) {
      context += `- Compliance: ${complianceObligations.filter(o => o.entity_id === entity.id).map(o => `${o.name} (${o.jurisdiction}, ${o.status})`).join('; ')}\n`;
    }
    context += '\n';
  }

  context += `## Directory (${directory.length} entries)\n\n`;
  for (const entry of directory) {
    context += `- ${entry.name} (${entry.type})`;
    if (entry.aliases && entry.aliases.length > 0) context += ` AKA: ${entry.aliases.join(', ')}`;
    context += '\n';
  }

  context += `\n## Relationships (${relationships.length} total)\n\n`;
  for (const rel of relationships) {
    const fromName = rel.from_entity_id ? entityNames[rel.from_entity_id] : (rel.from_directory_id ? dirNames[rel.from_directory_id] : 'Unknown');
    const toName = rel.to_entity_id ? entityNames[rel.to_entity_id] : (rel.to_directory_id ? dirNames[rel.to_directory_id] : 'Unknown');
    context += `- ${rel.type.replace(/_/g, ' ')}: ${fromName} → ${toName}`;
    if (rel.description) context += ` (${rel.description})`;
    context += '\n';
  }

  // Investments with investors, co-investors, allocations
  const investmentsRes = await supabase.from("investments").select("*").eq("organization_id", orgId).order("name");
  const investments = investmentsRes.data || [];

  if (investments.length > 0) {
    const investmentIds = investments.map(i => i.id);
    const investorsRes = await supabase.from("investment_investors").select("id, investment_id, entity_id, capital_pct, profit_pct, committed_capital, is_active").in("investment_id", investmentIds).eq("is_active", true);
    const investors = investorsRes.data || [];
    const coInvestorsRes = await supabase.from("investment_co_investors").select("investment_id, directory_entry_id, role, capital_pct, profit_pct").in("investment_id", investmentIds);
    const coInvestors = coInvestorsRes.data || [];
    const investorIds = investors.map(i => i.id);
    const allocationsRes = investorIds.length > 0
      ? await supabase.from("investment_allocations").select("investment_investor_id, member_directory_id, member_entity_id, allocation_pct, is_active").in("investment_investor_id", investorIds).eq("is_active", true)
      : { data: [], error: null };
    const allocations = allocationsRes.data || [];

    context += `\n## Investments (${investments.length} total)\n\n`;
    for (const inv of investments) {
      context += `### ${inv.name} (id: ${inv.id})\n`;
      context += `- Type: ${inv.investment_type.replace(/_/g, ' ')}, Status: ${inv.status}\n`;
      if (inv.preferred_return_pct) context += `- Preferred Return: ${inv.preferred_return_pct}%\n`;
      if (inv.description) context += `- Description: ${inv.description}\n`;

      const invInvestors = investors.filter(ii => ii.investment_id === inv.id);
      if (invInvestors.length > 0) {
        context += `- Investors:\n`;
        for (const ii of invInvestors) {
          const eName = entityNames[ii.entity_id] || 'Unknown';
          context += `  - ${eName} (entity_id: ${ii.entity_id})`;
          if (ii.capital_pct != null) context += ` Capital: ${ii.capital_pct}%`;
          if (ii.profit_pct != null) context += `, Profit: ${ii.profit_pct}%`;
          if (ii.committed_capital != null) context += `, Committed: $${Number(ii.committed_capital).toLocaleString()}`;
          context += '\n';

          // Allocations for this investor
          const invAllocs = allocations.filter(a => a.investment_investor_id === ii.id);
          if (invAllocs.length > 0) {
            context += `    Internal Allocations:\n`;
            for (const alloc of invAllocs) {
              const mName = alloc.member_entity_id ? (entityNames[alloc.member_entity_id] || 'Unknown') : alloc.member_directory_id ? (dirNames[alloc.member_directory_id] || 'Unknown') : 'Unknown';
              context += `    - ${mName}: ${alloc.allocation_pct}%\n`;
            }
          }
        }
      }

      const invCoInvestors = coInvestors.filter(c => c.investment_id === inv.id);
      if (invCoInvestors.length > 0) {
        context += `- Co-investors:\n`;
        for (const ci of invCoInvestors) {
          context += `  - ${dirNames[ci.directory_entry_id] || 'Unknown'} [${ci.role}]`;
          if (ci.capital_pct != null) context += ` Capital: ${ci.capital_pct}%`;
          context += '\n';
        }
      }
      context += '\n';
    }
  }

  // Cache
  if (client) {
    try {
      await client.set(cacheKey, context, { ex: SAFETY_TTL_SEC });
    } catch { /* Redis unavailable */ }
  }

  return context;
}
