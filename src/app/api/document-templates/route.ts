/**
 * @deprecated Superseded by /api/documents/overrides and /api/documents/profiles
 * (PR 4 of the compliance redesign). The refreshEntityExpectations engine no
 * longer reads from document_expectation_templates, so writes through this
 * route have no effect on entity expectations. No frontend code calls it as
 * of PR 4.4a. Kept for one release cycle as a rollback fallback, then deleted
 * along with the underlying table.
 *
 * Only remaining caller: the inference engine's "promote pattern to template"
 * action (lib/utils/inference-engine.ts). That path needs rewiring to write
 * to document_profiles — tracked as part of the inference engine activation
 * (original spec's PR 6).
 */
import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { requireSensitive } from "@/lib/utils/aal";
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

    const db = createOrgClient(orgId);

    // Fetch templates
    const { data: templates, error } = await db
      .from("document_expectation_templates")
      .select("*")
      .order("document_category")
      .order("document_type");

    if (error) {
      console.error("GET /api/document-templates query:", error);
      return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
    }

    // Fetch entity count for stats
    const { count: entityCount } = await db
      .from("entities")
      .select("id", { count: "exact", head: true })
      .neq("status", "deleted");

    // Fetch expectation stats per template
    const templateIds = (templates || []).map((t: { id: string }) => t.id);
    const stats: Record<string, { applied: number; satisfied: number }> = {};

    if (templateIds.length > 0) {
      const { data: expectations } = await db
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
    const { data: systemExpectations } = await db
      .from("entity_document_expectations")
      .select("document_type, is_satisfied")
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

    const db = createOrgClient(orgId);

    const { data, error } = await db
      .from("document_expectation_templates")
      .insert({
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
      console.error("POST /api/document-templates insert:", error);
      return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
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
    const ctx = await requireSensitive("records:delete");
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const body = await request.json();
    const { template_id } = body;

    if (!template_id) {
      return NextResponse.json({ error: "template_id required" }, { status: 400 });
    }

    const db = createOrgClient(orgId);

    // Check if any expectations from this template are satisfied — convert to manual
    await db
      .from("entity_document_expectations")
      .update({ source: "manual", template_id: null, updated_at: new Date().toISOString() })
      .eq("template_id", template_id)
      .eq("is_satisfied", true);

    // Remove unsatisfied expectations from this template
    await db
      .from("entity_document_expectations")
      .delete()
      .eq("template_id", template_id)
      .eq("is_satisfied", false);

    // Delete the template itself
    const { error } = await db
      .from("document_expectation_templates")
      .delete()
      .eq("id", template_id);

    if (error) {
      console.error("DELETE /api/document-templates delete:", error);
      return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/document-templates error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/document-templates
 * Update a custom template's filter or settings. Body: { template_id, applies_to_filter?, is_required? }
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const body = await request.json();
    const { template_id, applies_to_filter, is_required } = body;

    if (!template_id) {
      return NextResponse.json({ error: "template_id required" }, { status: 400 });
    }

    const db = createOrgClient(orgId);

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (applies_to_filter !== undefined) updates.applies_to_filter = applies_to_filter;
    if (is_required !== undefined) updates.is_required = is_required;

    const { error } = await db
      .from("document_expectation_templates")
      .update(updates)
      .eq("id", template_id)
      .neq("source", "system");

    if (error) {
      console.error("PUT /api/document-templates update:", error);
      return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
    }

    // Re-apply template to matching entities (add to new matches, remove from non-matches)
    await applyTemplate(template_id).catch(() => {});

    // Remove expectations from entities that no longer match the filter
    if (applies_to_filter) {
      const { data: allExpectations } = await db
        .from("entity_document_expectations")
        .select("id, entity_id")
        .eq("template_id", template_id)
        .eq("is_satisfied", false);

      if (allExpectations && allExpectations.length > 0) {
        const entityIds = [...new Set(allExpectations.map((e: { entity_id: string }) => e.entity_id))];
        const { data: entities } = await db
          .from("entities")
          .select("id, type, legal_structure, organization_id")
          .in("id", entityIds);

        const { matchesFilter } = await import("@/lib/utils/document-expectations");
        const nonMatchingIds: string[] = [];
        for (const entity of entities || []) {
          if (!matchesFilter(entity, applies_to_filter)) {
            nonMatchingIds.push(entity.id);
          }
        }

        if (nonMatchingIds.length > 0) {
          await db
            .from("entity_document_expectations")
            .delete()
            .eq("template_id", template_id)
            .eq("is_satisfied", false)
            .in("entity_id", nonMatchingIds);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PUT /api/document-templates error:", err);
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

    const db = createOrgClient(orgId);

    // Check if override row already exists
    const { data: existing } = await db
      .from("document_expectation_templates")
      .select("id")
      .eq("document_type", document_type)
      .eq("source", "system")
      .maybeSingle();

    const disabled = is_disabled ?? false;
    const required = is_required ?? systemDefault.is_required;

    if (existing) {
      await db
        .from("document_expectation_templates")
        .update({
          is_required: required,
          applies_to_filter: disabled ? { disabled: true } : {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await db
        .from("document_expectation_templates")
        .insert({
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
      await db
        .from("entity_document_expectations")
        .delete()
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
