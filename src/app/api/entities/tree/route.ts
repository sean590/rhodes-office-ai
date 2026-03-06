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
      .select("*")
      .eq("organization_id", orgId)
      .neq("status", "deleted")
      .order("name");

    if (entitiesError) {
      return NextResponse.json({ error: entitiesError.message }, { status: 500 });
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

    // Build a map of entity id -> enriched data
    const entityMap = new Map<string, TreeNode>();

    for (const entity of entities) {
      const entityRegistrations = registrations.filter((r) => r.entity_id === entity.id);

      // Count relationships where this entity is either from or to
      const relCount =
        relationshipsFrom.filter((r) => r.from_entity_id === entity.id).length +
        relationshipsTo.filter((r) => r.to_entity_id === entity.id).length;

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

    return NextResponse.json(roots);
  } catch (err) {
    console.error("GET /api/entities/tree error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
