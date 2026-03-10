import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError, validateEntityOrg } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import {
  refreshEntityExpectations,
  recheckEntityExpectations,
} from "@/lib/utils/document-expectations";

/**
 * GET /api/entities/[id]/expectations
 * Returns all expectations for an entity, with satisfied_by document info.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const { id } = await params;
    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("entity_document_expectations")
      .select("*, satisfied_doc:documents!satisfied_by(id, name, document_type, year, created_at)")
      .eq("entity_id", id)
      .order("document_category")
      .order("is_required", { ascending: false })
      .order("document_type");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("GET /api/entities/[id]/expectations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/entities/[id]/expectations
 * Actions: "refresh" (regenerate from system+templates), "add" (manual item),
 * "mark_na", "mark_needed", "recheck" (re-scan documents)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id } = await params;
    const isValid = await validateEntityOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

    const body = await request.json();
    const action = body.action as string;
    const admin = createAdminClient();

    if (action === "refresh") {
      await refreshEntityExpectations(id);
      await recheckEntityExpectations(id);
      return NextResponse.json({ success: true });
    }

    if (action === "recheck") {
      await recheckEntityExpectations(id);
      return NextResponse.json({ success: true });
    }

    if (action === "add") {
      const { document_type, document_category, is_required, notes } = body;
      if (!document_type || !document_category) {
        return NextResponse.json({ error: "document_type and document_category required" }, { status: 400 });
      }

      const { data, error } = await admin
        .from("entity_document_expectations")
        .upsert(
          {
            entity_id: id,
            organization_id: orgId,
            document_type,
            document_category,
            is_required: is_required ?? true,
            source: "manual",
            notes: notes || null,
          },
          { onConflict: "entity_id,document_type" }
        )
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const reqHeaders = await headers();
      const reqCtx = getRequestContext(reqHeaders, orgId);
      await logAuditEvent({
        userId: user.id,
        action: "create",
        resourceType: "document_expectation",
        resourceId: data.id,
        entityId: id,
        metadata: { document_type, document_category },
        ...reqCtx,
      });

      return NextResponse.json(data, { status: 201 });
    }

    if (action === "mark_na" || action === "mark_needed") {
      const { expectation_id } = body;
      if (!expectation_id) {
        return NextResponse.json({ error: "expectation_id required" }, { status: 400 });
      }

      await admin
        .from("entity_document_expectations")
        .update({
          is_not_applicable: action === "mark_na",
          updated_at: new Date().toISOString(),
        })
        .eq("id", expectation_id)
        .eq("entity_id", id);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("POST /api/entities/[id]/expectations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
