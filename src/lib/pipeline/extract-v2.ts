/**
 * Tier 2: Deep Extraction with trimmed entity context.
 * Instead of serializing the entire org, only includes the matched entity's data.
 * ~75% smaller prompts = faster API calls + lower cost.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOrgContext } from "@/lib/utils/org-data";
import { extractDocument } from "./extract";
import type { ExtractionResult } from "./extract";
import type { Tier1Result } from "./triage";

// --- Trimmed Entity Context ---

export interface Tier2EntityContext {
  entity: {
    id: string;
    name: string;
    short_name: string | null;
    type: string;
    ein: string | null;
    formation_state: string;
    status: string;
    business_purpose: string | null;
  };
  members: Array<{ name: string; directory_entry_id: string | null; ref_entity_id: string | null }>;
  managers: Array<{ name: string }>;
  relationships: Array<{ type: string; from_entity_id: string | null; to_entity_id: string | null; description: string | null }>;
  compliance: Array<{ name: string; jurisdiction: string; status: string; next_due_date: string | null }>;
  cap_table: Array<{ investor_name: string | null; investor_entity_id: string | null; ownership_pct: number }>;
  trust_details?: { trust_type: string; grantor_name: string | null; situs_state: string | null };
  trust_roles?: Array<{ role: string; name: string }>;
  investment?: {
    id: string;
    name: string;
    investment_type: string;
    investors: Array<{ entity_id: string; entity_name: string; capital_pct: number | null; profit_pct: number | null }>;
    co_investors: Array<{ name: string; role: string; capital_pct: number | null; profit_pct: number | null }>;
  };
  other_entities: Array<{ id: string; name: string; type: string }>;
}

// --- Context Cache ---

const contextCache = new Map<string, Tier2EntityContext>();

export function clearContextCache() {
  contextCache.clear();
}

// --- Fetch Entity Context ---

export async function fetchEntityContext(
  entityId: string,
  orgId: string,
  investmentId?: string | null,
): Promise<Tier2EntityContext> {
  const cacheKey = `${entityId}:${investmentId || ""}`;
  if (contextCache.has(cacheKey)) {
    return contextCache.get(cacheKey)!;
  }

  // Use shared org data fetcher
  const orgCtx = await fetchOrgContext(orgId, { entityId, investmentId: investmentId || undefined });

  const entity = orgCtx.entityById.get(entityId);
  if (!entity) throw new Error(`Entity ${entityId} not found`);

  // Filter data to this entity
  const entityMembers = orgCtx.members.filter((m) => m.entity_id === entityId);
  const entityManagers = orgCtx.managers.filter((m) => m.entity_id === entityId);
  const entityRelationships = orgCtx.relationships.filter((r) =>
    r.from_entity_id === entityId || r.to_entity_id === entityId
  );
  const entityCompliance = orgCtx.compliance.filter((c) => c.entity_id === entityId);
  const entityCapTable = orgCtx.capTable.filter((c) => c.entity_id === entityId);
  const entityTrust = orgCtx.trustDetails.find((t) => t.entity_id === entityId);
  const entityTrustRoles = entityTrust
    ? orgCtx.trustRoles.filter((r) => r.trust_detail_id === entityTrust.id)
    : [];
  const otherEntities = orgCtx.entities.filter((e) => e.id !== entityId);

  // Investment context
  let investmentContext: Tier2EntityContext["investment"] = undefined;
  if (investmentId) {
    const inv = orgCtx.investmentById.get(investmentId);
    if (inv) {
      const investors = orgCtx.investmentInvestors.filter((ii) => ii.investment_id === investmentId);
      investmentContext = {
        id: inv.id as string,
        name: inv.name as string,
        investment_type: inv.investment_type as string,
        investors: investors.map((i) => {
          const ent = i.entities as { name: string } | { name: string }[] | null;
          const entName = Array.isArray(ent) ? ent[0]?.name : (ent as { name: string } | null)?.name;
          return {
            entity_id: i.entity_id as string,
            entity_name: (entName || orgCtx.entityById.get(i.entity_id as string)?.name || "Unknown") as string,
            capital_pct: i.capital_pct as number | null,
            profit_pct: i.profit_pct as number | null,
          };
        }),
        co_investors: [], // Co-investors not fetched by shared fetcher yet — can add later
      };
    }
  }

  const context: Tier2EntityContext = {
    entity: {
      id: entity.id as string,
      name: entity.name as string,
      short_name: (entity.short_name as string) || null,
      type: entity.type as string,
      ein: (entity.ein as string) || null,
      formation_state: entity.formation_state as string,
      status: entity.status as string,
      business_purpose: (entity.business_purpose as string) || null,
    },
    members: entityMembers as Array<{ name: string; directory_entry_id: string | null; ref_entity_id: string | null }>,
    managers: entityManagers as Array<{ name: string }>,
    relationships: entityRelationships as Array<{ type: string; from_entity_id: string | null; to_entity_id: string | null; description: string | null }>,
    compliance: entityCompliance as Array<{ name: string; jurisdiction: string; status: string; next_due_date: string | null }>,
    cap_table: entityCapTable as Array<{ investor_name: string | null; investor_entity_id: string | null; ownership_pct: number }>,
    trust_details: entityTrust ? {
      trust_type: entityTrust.trust_type as string,
      grantor_name: (entityTrust.grantor_name as string) || null,
      situs_state: (entityTrust.situs_state as string) || null,
    } : undefined,
    trust_roles: entityTrustRoles.length > 0 ? entityTrustRoles as Array<{ role: string; name: string }> : undefined,
    investment: investmentContext,
    other_entities: otherEntities.map((e) => ({ id: e.id as string, name: e.name as string, type: e.type as string })),
  };

  contextCache.set(cacheKey, context);
  return context;
}

// --- Build Trimmed Context for Extraction Prompt ---

export function buildTrimmedContextString(ctx: Tier2EntityContext): string {
  let s = `## Primary Entity: ${ctx.entity.name}\n`;
  s += `- Type: ${ctx.entity.type}, Status: ${ctx.entity.status}\n`;
  s += `- EIN: ${ctx.entity.ein || "N/A"}, State: ${ctx.entity.formation_state}\n`;
  if (ctx.entity.business_purpose) s += `- Purpose: ${ctx.entity.business_purpose}\n`;

  if (ctx.members.length > 0) {
    s += `\n### Members\n${ctx.members.map((m) => `- ${m.name}`).join("\n")}\n`;
  }
  if (ctx.managers.length > 0) {
    s += `\n### Managers\n${ctx.managers.map((m) => `- ${m.name}`).join("\n")}\n`;
  }
  if (ctx.cap_table.length > 0) {
    s += `\n### Cap Table\n${ctx.cap_table.map((c) => `- ${c.investor_name || "Unknown"}: ${c.ownership_pct}%`).join("\n")}\n`;
  }
  if (ctx.compliance.length > 0) {
    s += `\n### Compliance\n${ctx.compliance.map((c) => `- ${c.name} (${c.jurisdiction}): ${c.status}, due: ${c.next_due_date || "N/A"}`).join("\n")}\n`;
  }
  if (ctx.trust_details) {
    s += `\n### Trust Details\n- Type: ${ctx.trust_details.trust_type}, Grantor: ${ctx.trust_details.grantor_name || "N/A"}\n`;
    if (ctx.trust_roles && ctx.trust_roles.length > 0) {
      s += ctx.trust_roles.map((r) => `- ${r.role}: ${r.name}`).join("\n") + "\n";
    }
  }
  if (ctx.investment) {
    s += `\n### Investment: ${ctx.investment.name} (${ctx.investment.investment_type})\n`;
    s += `Investors:\n${ctx.investment.investors.map((i) => `- ${i.entity_name} (Capital: ${i.capital_pct ?? "—"}%, Profit: ${i.profit_pct ?? "—"}%)`).join("\n")}\n`;
    if (ctx.investment.co_investors.length > 0) {
      s += `Co-investors:\n${ctx.investment.co_investors.map((c) => `- ${c.name} [${c.role}] (Capital: ${c.capital_pct ?? "—"}%, Profit: ${c.profit_pct ?? "—"}%)`).join("\n")}\n`;
    }
  }
  if (ctx.other_entities.length > 0) {
    s += `\n### Other Entities (reference only)\n${ctx.other_entities.map((e) => `- ${e.name} (${e.type})`).join("\n")}\n`;
  }

  return s;
}

// --- Tier 2 Extraction (Trimmed Context — legacy fast path) ---

export async function runTier2Trimmed(
  fileData: Buffer | Blob,
  mimeType: string,
  filename: string,
  triageResult: Tier1Result,
  entityContext: Tier2EntityContext,
  options?: {
    userContext?: string;
    entityDiscovery?: boolean;
    compositeDetection?: boolean;
  },
): Promise<ExtractionResult> {
  const orgContext = buildTrimmedContextString(entityContext);
  return extractDocument(
    fileData, mimeType, filename,
    triageResult.document_type || null, triageResult.year || null,
    orgContext,
    {
      entityDiscovery: options?.entityDiscovery ?? false,
      compositeDetection: options?.compositeDetection ?? false,
      userContext: options?.userContext,
    },
  );
}

// --- Tier 2 Extraction (Full Context — default path) ---

export async function runTier2(
  fileData: Buffer | Blob,
  mimeType: string,
  filename: string,
  triageResult: Tier1Result,
  orgContext: string,
  options?: {
    userContext?: string;
    entityDiscovery?: boolean;
    compositeDetection?: boolean;
  },
): Promise<ExtractionResult> {
  return extractDocument(
    fileData, mimeType, filename,
    triageResult.document_type || null, triageResult.year || null,
    orgContext,
    {
      entityDiscovery: options?.entityDiscovery ?? false,
      compositeDetection: options?.compositeDetection ?? false,
      userContext: options?.userContext,
    },
  );
}
