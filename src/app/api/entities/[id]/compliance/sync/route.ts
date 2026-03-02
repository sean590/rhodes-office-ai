import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateComplianceObligations } from "@/lib/utils/compliance-engine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();

    // Fetch entity
    const { data: entity, error: entityError } = await supabase
      .from("entities")
      .select("id, legal_structure, formation_state, formed_date")
      .eq("id", id)
      .single();

    if (entityError) {
      if (entityError.code === "PGRST116") {
        return NextResponse.json({ error: "Entity not found" }, { status: 404 });
      }
      return NextResponse.json({ error: entityError.message }, { status: 500 });
    }

    if (!entity.legal_structure) {
      return NextResponse.json(
        { error: "Entity must have a legal structure set to generate compliance obligations" },
        { status: 400 }
      );
    }

    // Fetch registrations and existing obligations in parallel
    const [registrationsRes, existingRes] = await Promise.all([
      supabase
        .from("entity_registrations")
        .select("jurisdiction, last_filing_date")
        .eq("entity_id", id),
      supabase
        .from("compliance_obligations")
        .select("id, rule_id, next_due_date, status, completed_at")
        .eq("entity_id", id),
    ]);

    const registrations = registrationsRes.data || [];
    const existing = existingRes.data || [];

    // Generate from rules
    const generated = generateComplianceObligations({
      id: entity.id,
      legal_structure: entity.legal_structure,
      formation_state: entity.formation_state,
      formed_date: entity.formed_date,
      registrations,
    });

    // Build lookup of existing obligations by rule_id+next_due_date
    const existingMap = new Map<string, typeof existing[0]>();
    for (const ex of existing) {
      existingMap.set(`${ex.rule_id}|${ex.next_due_date}`, ex);
    }

    // Build set of generated rule_ids to detect removals
    const generatedRuleIds = new Set(generated.map((g) => g.rule_id));

    // Upsert generated obligations (preserve completed/exempt status for existing)
    const rows = generated
      .filter((g) => {
        const key = `${g.rule_id}|${g.next_due_date}`;
        const ex = existingMap.get(key);
        // Skip if already completed or exempt — don't overwrite
        if (ex && (ex.status === "completed" || ex.status === "exempt" || ex.status === "not_applicable")) {
          return false;
        }
        return true;
      })
      .map((g) => ({
        entity_id: id,
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
      const { error: upsertError } = await admin
        .from("compliance_obligations")
        .upsert(rows, { onConflict: "entity_id,rule_id,next_due_date" });

      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    // Seed from entity_registrations.last_filing_date for SOS annual report obligations
    for (const reg of registrations) {
      if (!reg.last_filing_date) continue;

      // Find annual_report obligation for this jurisdiction
      const matchingGenerated = generated.find(
        (g) =>
          g.jurisdiction === reg.jurisdiction &&
          g.obligation_type === "annual_report"
      );

      if (!matchingGenerated) continue;

      // Check if this obligation already has a completed_at
      const existingObl = existing.find(
        (ex) => ex.rule_id === matchingGenerated.rule_id && ex.status !== "completed"
      );

      if (existingObl && !existingObl.completed_at) {
        // Seed the completed_at from last_filing_date
        await admin
          .from("compliance_obligations")
          .update({
            completed_at: reg.last_filing_date,
            status: "completed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingObl.id);
      }
    }

    // Remove obligations for jurisdictions no longer registered in
    const currentJurisdictions = new Set<string>();
    currentJurisdictions.add(entity.formation_state);
    for (const reg of registrations) {
      currentJurisdictions.add(reg.jurisdiction);
    }

    const toRemove = existing.filter(
      (ex) => !generatedRuleIds.has(ex.rule_id) && ex.status === "pending"
    );

    if (toRemove.length > 0) {
      await admin
        .from("compliance_obligations")
        .delete()
        .in(
          "id",
          toRemove.map((r) => r.id)
        );
    }

    // Fetch final state
    const { data: updated, error: fetchError } = await supabase
      .from("compliance_obligations")
      .select("*")
      .eq("entity_id", id)
      .order("next_due_date", { ascending: true, nullsFirst: false });

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    return NextResponse.json({
      obligations: updated || [],
      generated_count: generated.length,
    });
  } catch (err) {
    console.error("POST /api/entities/[id]/compliance/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
