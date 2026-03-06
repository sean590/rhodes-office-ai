import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateComplianceObligations } from "@/lib/utils/compliance-engine";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const supabase = await createClient();

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

    // Fetch registrations
    const { data: registrations } = await supabase
      .from("entity_registrations")
      .select("jurisdiction")
      .eq("entity_id", id);

    // Fetch existing obligations
    const { data: obligations, error: oblError } = await supabase
      .from("compliance_obligations")
      .select("*")
      .eq("entity_id", id)
      .order("next_due_date", { ascending: true, nullsFirst: false });

    if (oblError) {
      return NextResponse.json({ error: oblError.message }, { status: 500 });
    }

    // If no obligations exist yet, auto-sync
    if (!obligations || obligations.length === 0) {
      if (!entity.legal_structure) {
        return NextResponse.json({ obligations: [] });
      }

      const generated = generateComplianceObligations({
        id: entity.id,
        legal_structure: entity.legal_structure,
        formation_state: entity.formation_state,
        formed_date: entity.formed_date,
        registrations: registrations || [],
      });

      if (generated.length === 0) {
        return NextResponse.json({ obligations: [] });
      }

      // Upsert generated obligations
      const admin = createAdminClient();
      const rows = generated.map((g) => ({
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

      const { data: inserted, error: insertError } = await admin
        .from("compliance_obligations")
        .upsert(rows, { onConflict: "entity_id,rule_id,next_due_date" })
        .select();

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      return NextResponse.json({
        obligations: inserted || [],
      });
    }

    return NextResponse.json({ obligations }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    console.error("GET /api/entities/[id]/compliance error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
