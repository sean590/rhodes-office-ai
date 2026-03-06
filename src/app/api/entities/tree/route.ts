import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateFilingStatus, getWorstFilingStatus } from "@/lib/utils/filing-status";
import { requireOrg, isError } from "@/lib/utils/org-context";
import type { Jurisdiction } from "@/lib/types";

interface TreeNode {
  id: string;
  name: string;
  type: string;
  formation_state: string;
  additional_reg_count: number;
  filing_status: "current" | "due_soon" | "overdue";
  relationship_count: number;
  children: TreeNode[];
}

export async function GET() {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId } = ctx;

  try {
    const supabase = await createClient();

    // Fetch all entities (exclude soft-deleted)
    const { data: entities, error: entitiesError } = await supabase
      .from("entities")
      .select("id, name, type, formation_state, parent_entity_id")
      .eq("organization_id", orgId)
      .neq("status", "deleted")
      .order("name")
      .limit(500);

    if (entitiesError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!entities || entities.length === 0) {
      return NextResponse.json([]);
    }

    const entityIds = entities.map((e) => e.id);

    // Fetch related data in parallel
    const [registrationsRes, relationshipsFromRes, relationshipsToRes] =
      await Promise.all([
        supabase
          .from("entity_registrations")
          .select("id, entity_id, jurisdiction, last_filing_date, filing_exempt")
          .in("entity_id", entityIds),
        supabase
          .from("relationships")
          .select("id, from_entity_id")
          .in("from_entity_id", entityIds),
        supabase
          .from("relationships")
          .select("id, to_entity_id")
          .in("to_entity_id", entityIds),
      ]);

    if (registrationsRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (relationshipsFromRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (relationshipsToRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const registrations = registrationsRes.data || [];
    const relationshipsFrom = relationshipsFromRes.data || [];
    const relationshipsTo = relationshipsToRes.data || [];

    // Build lookup maps for O(1) access
    const regMap = new Map<string, typeof registrations>();
    for (const r of registrations) {
      const arr = regMap.get(r.entity_id) || [];
      arr.push(r);
      regMap.set(r.entity_id, arr);
    }
    const relFromCount = new Map<string, number>();
    for (const r of relationshipsFrom) {
      relFromCount.set(r.from_entity_id, (relFromCount.get(r.from_entity_id) || 0) + 1);
    }
    const relToCount = new Map<string, number>();
    for (const r of relationshipsTo) {
      relToCount.set(r.to_entity_id, (relToCount.get(r.to_entity_id) || 0) + 1);
    }

    // Build a map of entity id -> enriched data
    const entityMap = new Map<string, TreeNode>();

    for (const entity of entities) {
      const entityRegistrations = regMap.get(entity.id) || [];

      // Count relationships where this entity is either from or to
      const relCount =
        (relFromCount.get(entity.id) || 0) + (relToCount.get(entity.id) || 0);

      // Additional registrations = total registrations beyond the formation state
      const additionalRegCount = entityRegistrations.filter(
        (r) => r.jurisdiction !== entity.formation_state
      ).length;

      // Calculate filing status across all jurisdictions
      const allJurisdictions: { jurisdiction: Jurisdiction; lastFiled: string | null; filingExempt: boolean }[] = [];

      // Formation state
      const formationReg = entityRegistrations.find(
        (r) => r.jurisdiction === entity.formation_state
      );
      allJurisdictions.push({
        jurisdiction: entity.formation_state as Jurisdiction,
        lastFiled: formationReg?.last_filing_date || null,
        filingExempt: formationReg?.filing_exempt || false,
      });

      // Other registration jurisdictions
      for (const reg of entityRegistrations) {
        if (reg.jurisdiction !== entity.formation_state) {
          allJurisdictions.push({
            jurisdiction: reg.jurisdiction as Jurisdiction,
            lastFiled: reg.last_filing_date || null,
            filingExempt: reg.filing_exempt || false,
          });
        }
      }

      const filingStatuses = allJurisdictions.map((j) =>
        calculateFilingStatus(j.lastFiled, j.jurisdiction, j.filingExempt)
      );
      const worstStatus = getWorstFilingStatus(filingStatuses);

      entityMap.set(entity.id, {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        formation_state: entity.formation_state,
        additional_reg_count: additionalRegCount,
        filing_status: worstStatus as "current" | "due_soon" | "overdue",
        relationship_count: relCount,
        children: [],
      });
    }

    // Build tree: assign children to parents
    const roots: TreeNode[] = [];

    for (const entity of entities) {
      const node = entityMap.get(entity.id)!;
      if (entity.parent_entity_id && entityMap.has(entity.parent_entity_id)) {
        entityMap.get(entity.parent_entity_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return NextResponse.json(roots, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    console.error("GET /api/entities/tree error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
