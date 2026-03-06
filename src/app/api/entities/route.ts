import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateFilingStatus, getWorstFilingStatus } from "@/lib/utils/filing-status";
import { validateShortName } from "@/lib/utils/document-naming";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { createEntitySchema } from "@/lib/validations";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";
import type { Jurisdiction } from "@/lib/types";

export async function GET(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId } = ctx;

  try {
    const supabase = await createClient();

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10), 500);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    // Fetch entities (exclude soft-deleted, omit heavy text fields for list view)
    const { data: entities, error: entitiesError } = await supabase
      .from("entities")
      .select("id, name, type, status, ein, formation_state, formed_date, registered_agent, short_name, parent_entity_id, legal_structure, organization_id, created_at, updated_at")
      .eq("organization_id", orgId)
      .neq("status", "deleted")
      .order("name")
      .range(offset, offset + limit - 1);

    if (entitiesError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    if (!entities || entities.length === 0) {
      return NextResponse.json([]);
    }

    const entityIds = entities.map((e) => e.id);

    // Fetch related data in parallel
    const [registrationsRes, managersRes, membersRes, relationshipsFromRes, relationshipsToRes, complianceRes] =
      await Promise.all([
        supabase
          .from("entity_registrations")
          .select("id, entity_id, jurisdiction, last_filing_date, filing_exempt")
          .in("entity_id", entityIds),
        supabase
          .from("entity_managers")
          .select("id, entity_id, name")
          .in("entity_id", entityIds),
        supabase
          .from("entity_members")
          .select("id, entity_id, name, ref_entity_id, directory_entry_id")
          .in("entity_id", entityIds),
        supabase
          .from("relationships")
          .select("id, from_entity_id")
          .in("from_entity_id", entityIds),
        supabase
          .from("relationships")
          .select("id, to_entity_id")
          .in("to_entity_id", entityIds),
        supabase
          .from("compliance_obligations")
          .select("entity_id, status, next_due_date")
          .in("entity_id", entityIds)
          .in("status", ["pending", "overdue", "completed"]),
      ]);

    if (registrationsRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (managersRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (membersRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (relationshipsFromRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (relationshipsToRes.error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    // complianceRes errors are non-fatal — fall back to old calculation

    const registrations = registrationsRes.data || [];
    const managers = managersRes.data || [];
    const members = membersRes.data || [];
    const relationshipsFrom = relationshipsFromRes.data || [];
    const relationshipsTo = relationshipsToRes.data || [];
    const complianceObligations = complianceRes.data || [];

    // Build lookup maps for O(1) access per entity (avoids O(n²) .filter() loops)
    const regMap = new Map<string, typeof registrations>();
    for (const r of registrations) {
      const arr = regMap.get(r.entity_id) || [];
      arr.push(r);
      regMap.set(r.entity_id, arr);
    }
    const mgrMap = new Map<string, typeof managers>();
    for (const m of managers) {
      const arr = mgrMap.get(m.entity_id) || [];
      arr.push(m);
      mgrMap.set(m.entity_id, arr);
    }
    const memMap = new Map<string, typeof members>();
    for (const m of members) {
      const arr = memMap.get(m.entity_id) || [];
      arr.push(m);
      memMap.set(m.entity_id, arr);
    }
    const relFromCount = new Map<string, number>();
    for (const r of relationshipsFrom) {
      relFromCount.set(r.from_entity_id, (relFromCount.get(r.from_entity_id) || 0) + 1);
    }
    const relToCount = new Map<string, number>();
    for (const r of relationshipsTo) {
      relToCount.set(r.to_entity_id, (relToCount.get(r.to_entity_id) || 0) + 1);
    }
    const oblMap = new Map<string, typeof complianceObligations>();
    for (const o of complianceObligations) {
      if (!o.entity_id) continue;
      const arr = oblMap.get(o.entity_id) || [];
      arr.push(o);
      oblMap.set(o.entity_id, arr);
    }

    // Build enriched entity list
    const enriched = entities.map((entity) => {
      const entityRegistrations = regMap.get(entity.id) || [];
      const entityManagers = mgrMap.get(entity.id) || [];
      const entityMembers = memMap.get(entity.id) || [];

      // Count relationships where this entity is either from or to
      const relCount =
        (relFromCount.get(entity.id) || 0) + (relToCount.get(entity.id) || 0);

      // Derive filing_status from compliance obligations if available, else fall back
      const entityObligations = oblMap.get(entity.id) || [];

      let worstStatus: string;
      if (entityObligations.length > 0) {
        // Use compliance obligations for status
        const now = new Date();
        const hasOverdue = entityObligations.some(
          (o) => o.status === "pending" && o.next_due_date && new Date(o.next_due_date) < now
        );
        const hasDueSoon = entityObligations.some((o) => {
          if (o.status !== "pending" || !o.next_due_date) return false;
          const diffDays = (new Date(o.next_due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
          return diffDays >= 0 && diffDays <= 60;
        });
        worstStatus = hasOverdue ? "overdue" : hasDueSoon ? "due_soon" : "current";
      } else {
        // Fall back to old calculation from registrations
        const allJurisdictions: { jurisdiction: Jurisdiction; lastFiled: string | null; filingExempt: boolean }[] = [];
        const formationReg = entityRegistrations.find(
          (r) => r.jurisdiction === entity.formation_state
        );
        allJurisdictions.push({
          jurisdiction: entity.formation_state as Jurisdiction,
          lastFiled: formationReg?.last_filing_date || null,
          filingExempt: formationReg?.filing_exempt || false,
        });
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
        worstStatus = getWorstFilingStatus(filingStatuses);
      }

      return {
        ...entity,
        registrations: entityRegistrations,
        managers: entityManagers,
        members: entityMembers,
        filing_status: worstStatus,
        relationship_count: relCount,
      };
    });

    return NextResponse.json(enriched, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    console.error("GET /api/entities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const ctx = await requireOrg();
  if (isError(ctx)) return ctx;
  const { orgId, user } = ctx;

  try {
    const supabase = createAdminClient();
    const body = await request.json();

    const parsed = createEntitySchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstError?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const {
      name,
      type,
      formation_state,
      short_name,
      ein,
      formed_date,
      registered_agent,
      address,
      parent_entity_id,
      notes,
      legal_structure,
    } = parsed.data;

    // Validate short_name format
    const snValidation = validateShortName(short_name);
    if (!snValidation.valid) {
      return NextResponse.json({ error: snValidation.error }, { status: 400 });
    }

    // Create the entity
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .insert({
        name,
        type,
        formation_state,
        short_name,
        ein: ein || null,
        formed_date: formed_date || null,
        registered_agent: registered_agent || null,
        address: address || null,
        parent_entity_id: parent_entity_id || null,
        notes: notes || null,
        legal_structure: legal_structure || (type === "trust" ? "trust" : null),
        organization_id: orgId,
      })
      .select()
      .single();

    if (entityError) {
      // Unique constraint violation on short_name
      if (entityError.code === "23505") {
        return NextResponse.json(
          { error: "An entity with this short name already exists." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Create the initial registration for the formation state
    const { error: regError } = await supabase.from("entity_registrations").insert({
      entity_id: entity.id,
      jurisdiction: formation_state,
    });

    if (regError) {
      console.error("Failed to create initial registration:", regError.message);
    }

    // Auto-create trust_details record for trust entities
    if (type === "trust") {
      const { error: trustError } = await supabase.from("trust_details").insert({
        entity_id: entity.id,
        trust_type: "revocable",
        situs_state: formation_state,
      });

      if (trustError) {
        console.error("Failed to create trust details:", trustError.message);
      }
    }

    // Audit log
    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create",
      resourceType: "entity",
      resourceId: entity.id,
      metadata: { name, type },
      ...reqCtx,
    });

    return NextResponse.json(entity, { status: 201 });
  } catch (err) {
    console.error("POST /api/entities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
