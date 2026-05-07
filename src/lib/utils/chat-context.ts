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
      client.del(`extraction-ctx:v2:${orgId}`),
      client.del(`extraction-ctx:v3:${orgId}`),
    ]);
  } catch (err) {
    console.error(`[invalidateOrgCaches] Failed to clear Redis cache for org ${orgId}:`, err);
  }
}

// buildChatContext deleted in Phase 3-4 cutover — the legacy chat path that
// consumed it is gone. invalidateOrgCaches above and buildExtractionContext
// below are still live (used by apply.ts, pipeline workers, REST endpoints).

// Placeholder so the line count stays stable for git blame. The function body
// (formerly ~420 lines of entity/relationship/investment context building)
// was removed; buildExtractionContext below duplicates the extraction-relevant
// subset and is the only remaining consumer of the pattern.
/**
 * Build extraction context — structural org data for Tier 2 extraction.
 * Same as buildChatContext but excludes documents, patterns, suggestions, signals,
 * and the chat instruction block. Used as the system prompt for extraction.
 * Cached in Redis at `extraction-ctx:${orgId}` with safety TTL.
 */
export async function buildExtractionContext(orgId: string): Promise<string> {
  const client = getRedis();
  // v3: Recent Transactions rows now expose investment_investor_id and
  //     [has_doc: true|false] so dedup can map line items to specific
  //     existing rows and decide whether to propose update vs record.
  // v2: added Recent Transactions block + relabeled investment/entity ids
  //     (`(investment_id: …)` / `(entity_id: …)` instead of ambiguous `(id: …)`).
  // Bump this any time the rendered context format changes — otherwise stale
  // caches keep returning the old format until their 24h TTL expires and the
  // model sees a snapshot that doesn't match the current prompt instructions.
  const cacheKey = `extraction-ctx:v3:${orgId}`;

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
    supabase.from("directory_entries").select("*").eq("organization_id", orgId).is("deleted_at", null).order("name"),
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

    context += `### ${entity.name} (entity_id: ${entity.id})\n`;
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

    // Existing transactions per investment, top-level only (no child rows).
    // Capped at 200 — most orgs are well under this; a wider net would bloat
    // every extraction prompt without buying real precision. Without this
    // block the extraction model has no way to know which capital calls /
    // distributions are already on the books and proposes duplicates when
    // a K-1 or distribution notice for the same period is uploaded.
    const transactionsRes = await supabase
      .from("investment_transactions")
      .select(
        "id, investment_id, investment_investor_id, transaction_type, amount, transaction_date, description, document_id",
      )
      .in("investment_id", investmentIds)
      .is("parent_transaction_id", null)
      .order("transaction_date", { ascending: false })
      .limit(200);
    const transactions = transactionsRes.data || [];

    context += `\n## Investments (${investments.length} total)\n\n`;
    for (const inv of investments) {
      context += `### ${inv.name} (investment_id: ${inv.id})\n`;
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

      // Recent transactions for this investment. The extraction prompt
      // uses this to dedup against incoming K-1s / distribution notices /
      // capital calls. Each row carries its txn_id so the model can
      // reference it in update_investment_transaction proposals.
      const invTransactions = transactions.filter((t) => t.investment_id === inv.id);
      if (invTransactions.length > 0) {
        context += `- Recent Transactions:\n`;
        for (const tx of invTransactions) {
          const investorRow = investors.find((ii) => ii.id === tx.investment_investor_id);
          const investorName = investorRow ? (entityNames[investorRow.entity_id] || 'Unknown') : 'Unknown';
          context += `  - ${tx.transaction_type} $${Number(tx.amount).toLocaleString()} on ${tx.transaction_date} (investor: ${investorName}, investment_investor_id: ${tx.investment_investor_id})`;
          if (tx.description) context += ` — ${tx.description}`;
          context += ` [txn_id: ${tx.id}, has_doc: ${tx.document_id ? 'true' : 'false'}]\n`;
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
