/**
 * Shared compliance sync logic — generates/upserts compliance obligations
 * for an entity based on the rules engine, preserving completed/exempt
 * statuses and cleaning up stale rules.
 *
 * Called from:
 * - POST /api/entities/[id]/compliance/sync (manual re-sync button)
 * - Entity creation (apply.ts create_entity, POST /api/entities)
 * - Legal structure / formation state changes
 * - Reactivation cascade (entity-lifecycle.ts)
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { generateComplianceObligations } from "./compliance-engine";

export async function syncComplianceForEntity(
  entityId: string,
  orgId: string,
): Promise<{ generated: number; upserted: number; removed: number }> {
  const admin = createAdminClient();

  // Fetch entity.
  const { data: entity, error: entErr } = await admin
    .from("entities")
    .select("id, status, type, legal_structure, tax_classification, formation_state, formed_date")
    .eq("id", entityId)
    .eq("organization_id", orgId)
    .single();
  if (entErr || !entity) return { generated: 0, upserted: 0, removed: 0 };

  // Don't generate for non-active entities.
  if (entity.status && entity.status !== "active") return { generated: 0, upserted: 0, removed: 0 };
  // Persons can be processed without legal_structure — they get federal
  // personal tax obligations via the engine's person scope. Other entities
  // still require a legal_structure for state rules to match.
  if (entity.type !== "person" && !entity.legal_structure) {
    return { generated: 0, upserted: 0, removed: 0 };
  }

  // Map legal_structure to the entity-type scope used by compliance profiles.
  const SCOPE_MAP: Record<string, string> = {
    llc: "llc", corporation: "corporation", lp: "lp", gp: "lp",
    grantor_trust: "trust", non_grantor_trust: "trust", series_llc: "llc",
  };
  const entityScope = entity.legal_structure
    ? SCOPE_MAP[entity.legal_structure as string] ?? null
    : (entity.type === "person" ? "person" : null);

  // Fetch registrations, existing obligations, org overrides, and entity-type profiles.
  const [regsRes, existingRes, orgOverridesRes, profilesRes] = await Promise.all([
    admin.from("entity_registrations").select("jurisdiction, last_filing_date").eq("entity_id", entityId),
    admin.from("compliance_obligations").select("id, rule_id, next_due_date, status, completed_at").eq("entity_id", entityId),
    admin.from("org_compliance_overrides").select("rule_id, obligation_type, jurisdiction, action").eq("organization_id", orgId),
    entityScope
      ? admin.from("compliance_profiles").select("rule_id, enabled").eq("organization_id", orgId).eq("entity_type_scope", entityScope)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const registrations = regsRes.data ?? [];
  const existing = existingRes.data ?? [];

  // Build set of disabled rule IDs from both tiers.
  const disabledRuleIds = new Set<string>();
  for (const o of (orgOverridesRes.data ?? []) as Array<{ rule_id: string | null; action: string }>) {
    if (o.action === "disable" && o.rule_id) disabledRuleIds.add(o.rule_id);
  }
  for (const p of (profilesRes.data ?? []) as Array<{ rule_id: string; enabled: boolean }>) {
    if (!p.enabled) disabledRuleIds.add(p.rule_id);
  }

  // Generate from rules (with override filtering).
  const generated = generateComplianceObligations(
    {
      id: entity.id,
      status: entity.status,
      type: entity.type,
      legal_structure: entity.legal_structure,
      tax_classification: entity.tax_classification ?? null,
      formation_state: entity.formation_state,
      formed_date: entity.formed_date,
      registrations,
    },
    { disabledRuleIds },
  );

  // Build lookup of existing.
  const existingMap = new Map<string, (typeof existing)[0]>();
  for (const ex of existing) existingMap.set(`${ex.rule_id}|${ex.next_due_date}`, ex);
  const generatedRuleIds = new Set(generated.map((g) => g.rule_id));

  // Upsert — skip completed/exempt/not_applicable.
  const rows = generated
    .filter((g) => {
      const key = `${g.rule_id}|${g.next_due_date}`;
      const ex = existingMap.get(key);
      return !(ex && ["completed", "exempt", "not_applicable"].includes(ex.status));
    })
    .map((g) => ({
      entity_id: entityId,
      rule_id: g.rule_id,
      jurisdiction: g.jurisdiction,
      obligation_type: g.obligation_type,
      name: g.name,
      description: g.description,
      frequency: g.frequency,
      next_due_date: g.next_due_date,
      fee_description: g.fee_description,
      form_number: g.form_number,
      portal_url: g.portal_url,
      filed_with: g.filed_with,
      penalty_description: g.penalty_description,
      status: "pending",
    }));

  if (rows.length > 0) {
    await admin
      .from("compliance_obligations")
      .upsert(rows, { onConflict: "entity_id,rule_id,next_due_date" });
  }

  // Seed completed_at from entity_registrations.last_filing_date for annual reports.
  for (const reg of registrations) {
    if (!reg.last_filing_date) continue;
    const match = generated.find(
      (g) => g.jurisdiction === reg.jurisdiction && g.obligation_type === "annual_report",
    );
    if (!match) continue;
    const ex = existing.find((e) => e.rule_id === match.rule_id && e.status !== "completed");
    if (ex && !ex.completed_at) {
      await admin
        .from("compliance_obligations")
        .update({ completed_at: reg.last_filing_date, status: "completed", updated_at: new Date().toISOString() })
        .eq("id", ex.id);
    }
  }

  // Remove stale pending obligations whose rules no longer apply.
  const toRemove = existing.filter((ex) => !generatedRuleIds.has(ex.rule_id) && ex.status === "pending");
  if (toRemove.length > 0) {
    await admin
      .from("compliance_obligations")
      .delete()
      .in("id", toRemove.map((r) => r.id));
  }

  // Fire-and-forget: refresh inferred document patterns across the org.
  // Compliance changes can flip the pattern picture (e.g. "most entities
  // now have their 2025 franchise payment on file"), so rerun inference.
  import("@/lib/utils/inference-engine")
    .then(({ runInferenceEngine }) =>
      runInferenceEngine(orgId).catch((err) =>
        console.error(`[COMPLIANCE] post-sync inference failed for org ${orgId}:`, err),
      ),
    )
    .catch(() => {});

  return { generated: generated.length, upserted: rows.length, removed: toRemove.length };
}
