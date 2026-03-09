import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyActions } from "@/lib/pipeline/apply";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id } = await params;
    const admin = createAdminClient();
    const body = await request.json();
    const { actions, action_indices, dismiss_all } = body;

    if (!Array.isArray(actions)) {
      return NextResponse.json({ error: "actions must be an array" }, { status: 400 });
    }

    // Get current document to preserve existing ai_extraction data
    const { data: doc, error: docError } = await admin
      .from("documents")
      .select("ai_extraction, entity_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (docError) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Apply actions via shared function
    const { results, firstCreatedEntityId } = await applyActions(actions, {
      documentId: id,
      existingEntityId: doc.entity_id || undefined,
      orgId,
    });

    // If document has no entity and we created one, associate them
    const docUpdate: Record<string, unknown> = {};
    if (!doc.entity_id && firstCreatedEntityId) {
      docUpdate.entity_id = firstCreatedEntityId;
    }

    // Track which action indices were applied
    const existingExtraction = (doc.ai_extraction || {}) as Record<string, unknown>;
    const allActions = (existingExtraction.actions || []) as unknown[];
    const previouslyAppliedIndices = (existingExtraction.applied_indices || []) as number[];

    const newIndices: number[] = Array.isArray(action_indices) ? action_indices : [];
    const allAppliedIndices = [...new Set([...previouslyAppliedIndices, ...newIndices])];

    const allApplied = dismiss_all || (allActions.length > 0 && allActions.every(
      (_, idx) => allAppliedIndices.includes(idx)
    ));

    const previousResults = (existingExtraction.applied_results || []) as unknown[];

    await admin
      .from("documents")
      .update({
        ...docUpdate,
        ai_extraction: {
          ...existingExtraction,
          applied: allApplied,
          applied_at: new Date().toISOString(),
          applied_indices: allAppliedIndices,
          applied_results: [...previousResults, ...results],
        },
      })
      .eq("id", id);

    // Audit log
    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    // Summarize applied actions for audit trail
    const actionSummaries = actions.map((a: { action: string; data: Record<string, unknown> }) => {
      const d = a.data || {};
      switch (a.action) {
        case "create_directory_entry": return `Created directory entry: ${d.name}`;
        case "create_relationship": return `Created relationship: ${d.type} — ${d.description || ""}`;
        case "add_member": return `Added member: ${d.name}`;
        case "add_manager": return `Added manager: ${d.name}`;
        case "add_registration": return `Added registration: ${d.jurisdiction}`;
        case "update_registration": return `Updated registration filing date`;
        case "update_entity": return `Updated entity fields: ${Object.keys(d.fields as Record<string, unknown> || {}).join(", ")}`;
        case "add_trust_role": return `Added trust role: ${d.role} = ${d.name}`;
        case "update_cap_table": return `Updated cap table: ${d.investor_name} (${d.ownership_pct}%)`;
        case "add_role": return `Added role: ${d.role_title} = ${d.name}`;
        case "add_partnership_rep": return `Added partnership rep: ${d.name}`;
        case "complete_obligation": return `Completed obligation`;
        default: return a.action;
      }
    });

    await logAuditEvent({
      userId: user.id,
      action: dismiss_all ? "dismiss_extraction" : "apply_extraction",
      resourceType: "document",
      resourceId: id,
      entityId: doc.entity_id,
      metadata: {
        applied: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        changes: actionSummaries,
        document_name: (existingExtraction.summary as string)?.slice(0, 80) || null,
      },
      ...reqCtx,
    });

    return NextResponse.json({
      applied: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  } catch (err) {
    console.error("POST /api/documents/[id]/apply error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
