import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { user } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();
    const body = await request.json();

    const allowedFields = [
      'staged_doc_type', 'staged_entity_id', 'staged_entity_name',
      'staged_year', 'staged_category',
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // Allow status change for retry (error → queued)
    if (body.status === 'queued') {
      updates.status = 'queued';
      updates.extraction_error = null;
      updates.extraction_started_at = null;
      updates.extraction_completed_at = null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Only set user_corrected for staging field changes
    if (Object.keys(updates).some((k) => allowedFields.includes(k))) {
      updates.user_corrected = true;
      updates.staging_confidence = 'user';
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await admin
      .from("document_queue")
      .update(updates)
      .eq("id", itemId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user.id,
      action: "edit",
      resourceType: "pipeline_item",
      resourceId: itemId,
      metadata: { fields_changed: Object.keys(updates).filter((k) => k !== "updated_at" && k !== "user_corrected" && k !== "staging_confidence") },
      ...reqCtx,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("PATCH /api/pipeline/queue/[itemId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
