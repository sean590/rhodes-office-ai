import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { applyTemplate, ALL_SYSTEM_DEFAULTS } from "@/lib/utils/document-expectations";

/**
 * GET /api/document-templates
 * Returns all org-wide document expectation templates + usage stats.
 */
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const admin = createAdminClient();

    // Fetch templates
    const { data: templates, error } = await admin
      .from("document_expectation_templates")
      .select("*")
      .eq("organization_id", orgId)
      .order("document_category")
      .order("document_type");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch entity count for stats
    const { count: entityCount } = await admin
      .from("entities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("deleted_at", null);

    // Fetch expectation stats per template
    const templateIds = (templates || []).map((t: { id: string }) => t.id);
    let stats: Record<string, { applied: number; satisfied: number }> = {};

    if (templateIds.length > 0) {
      const { data: expectations } = await admin
        .from("entity_document_expectations")
        .select("template_id, is_satisfied")
        .in("template_id", templateIds);

      for (const exp of expectations || []) {
        const tid = exp.template_id as string;
        if (!stats[tid]) stats[tid] = { applied: 0, satisfied: 0 };
        stats[tid].applied++;
        if (exp.is_satisfied) stats[tid].satisfied++;
      }
    }

    // Also count system expectations (no template_id)
    const { data: systemExpectations } = await admin
      .from("entity_document_expectations")
      .select("document_type, is_satisfied")
      .eq("organization_id", orgId)
      .eq("source", "system");

    const systemStats: Record<string, { applied: number; satisfied: number }> = {};
    for (const exp of systemExpectations || []) {
      const dt = exp.document_type as string;
      if (!systemStats[dt]) systemStats[dt] = { applied: 0, satisfied: 0 };
      systemStats[dt].applied++;
      if (exp.is_satisfied) systemStats[dt].satisfied++;
    }

    // Extract system override rows (source='system') to return override state
    const systemOverrides: Record<string, { is_disabled: boolean; is_required: boolean }> = {};
    for (const tpl of templates || []) {
      if ((tpl as Record<string, unknown>).source === "system") {
        const filter = (tpl as Record<string, unknown>).applies_to_filter as Record<string, unknown> | null;
        systemOverrides[(tpl as Record<string, unknown>).document_type as string] = {
          is_disabled: filter?.disabled === true,
          is_required: (tpl as Record<string, unknown>).is_required as boolean,
        };
      }
    }

    // Filter out system override rows from the custom templates list
    const customTemplates = (templates || []).filter(
      (t: Record<string, unknown>) => t.source !== "system"
    );

    return NextResponse.json({
      templates: customTemplates,
      templateStats: stats,
      systemStats,
      systemOverrides,
      systemDefaults: ALL_SYSTEM_DEFAULTS,
      entityCount: entityCount || 0,
    });
  } catch (err) {
    console.error("GET /api/document-templates error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/document-templates
 * Create a new org-wide template and backfill to matching entities.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const body = await request.json();
    const { document_type, document_category, is_required, description, applies_to_filter } = body;

    if (!document_type || !document_category) {
      return NextResponse.json({ error: "document_type and document_category required" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("document_expectation_templates")
      .insert({
        organization_id: orgId,
        document_type: document_type.trim().toLowerCase().replace(/\s+/g, "_"),
        document_category,
        is_required: is_required ?? true,
        description: description || null,
        applies_to_filter: applies_to_filter || {},
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "A template for this document type already exists" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Backfill to matching entities
    const applied = await applyTemplate(data.id).catch(() => 0);

    return NextResponse.json({ ...data, applied_count: applied }, { status: 201 });
  } catch (err) {
    console.error("POST /api/document-templates error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/document-templates
 * Delete a template. Body: { template_id }
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const body = await request.json();
    const { template_id } = body;

    if (!template_id) {
      return NextResponse.json({ error: "template_id required" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Check if any expectations from this template are satisfied — convert to manual
    await admin
      .from("entity_document_expectations")
      .update({ source: "manual", template_id: null, updated_at: new Date().toISOString() })
      .eq("template_id", template_id)
      .eq("is_satisfied", true);

    // Remove unsatisfied expectations from this template
    await admin
      .from("entity_document_expectations")
      .delete()
      .eq("template_id", template_id)
      .eq("is_satisfied", false);

    // Delete the template itself
    const { error } = await admin
      .from("document_expectation_templates")
      .delete()
      .eq("id", template_id)
      .eq("organization_id", orgId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/document-templates error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/document-templates
 * Update a system default override. Body: { document_type, is_disabled?, is_required? }
 * Creates/updates a template row with source='system' to store org-level overrides.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    // Only owner can modify system defaults
    if (user.orgRole !== "owner") {
      return NextResponse.json({ error: "Only owners can modify system defaults" }, { status: 403 });
    }

    const body = await request.json();
    const { document_type, is_disabled, is_required } = body;

    if (!document_type) {
      return NextResponse.json({ error: "document_type required" }, { status: 400 });
    }

    // Verify this is a real system default
    const systemDefault = ALL_SYSTEM_DEFAULTS.find((d) => d.document_type === document_type);
    if (!systemDefault) {
      return NextResponse.json({ error: "Not a system default" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Check if override row already exists
    const { data: existing } = await admin
      .from("document_expectation_templates")
      .select("id")
      .eq("organization_id", orgId)
      .eq("document_type", document_type)
      .eq("source", "system")
      .maybeSingle();

    const disabled = is_disabled ?? false;
    const required = is_required ?? systemDefault.is_required;

    if (existing) {
      await admin
        .from("document_expectation_templates")
        .update({
          is_required: required,
          applies_to_filter: disabled ? { disabled: true } : {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await admin
        .from("document_expectation_templates")
        .insert({
          organization_id: orgId,
          document_type,
          document_category: systemDefault.document_category,
          is_required: required,
          source: "system",
          applies_to_filter: disabled ? { disabled: true } : {},
          created_by: user.id,
        });
    }

    // If disabling, remove unsatisfied expectations of this type across all entities
    if (disabled) {
      await admin
        .from("entity_document_expectations")
        .delete()
        .eq("organization_id", orgId)
        .eq("document_type", document_type)
        .eq("source", "system")
        .eq("is_satisfied", false);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/document-templates error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
