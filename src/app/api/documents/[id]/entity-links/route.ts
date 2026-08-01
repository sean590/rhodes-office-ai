import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import {
  addDocumentEntityLink,
  removeDocumentEntityLink,
  listDocumentEntityLinks,
} from "@/lib/document-entity-links";

/**
 * GET /api/documents/[id]/entity-links
 * Every entity the document is associated with (primary home + junction links).
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

    // Shared service filters by organization_id explicitly on every read/write.
    const db = createOrgClient(orgId).raw;
    const links = await listDocumentEntityLinks(db, orgId, id);
    return NextResponse.json(links);
  } catch (err) {
    console.error("GET /api/documents/[id]/entity-links error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/documents/[id]/entity-links
 * Add an additional entity association (does not move the home entity).
 * Body: { entity_id: string, role?: string }
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
    const body = await request.json();

    const db = createOrgClient(orgId).raw;
    const { ok, error, alreadyPrimary } = await addDocumentEntityLink(db, orgId, user.id, {
      documentId: id,
      entityId: body.entity_id,
      role: body.role,
    });
    if (!ok) return NextResponse.json({ error: error || "Failed to link" }, { status: 400 });

    const links = await listDocumentEntityLinks(db, orgId, id);
    return NextResponse.json({ links, already_primary: !!alreadyPrimary }, { status: 201 });
  } catch (err) {
    console.error("POST /api/documents/[id]/entity-links error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/documents/[id]/entity-links
 * Remove an additional entity association.
 * Body: { entity_id: string }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;
    const body = await request.json();

    const db = createOrgClient(orgId).raw;
    const { ok, error } = await removeDocumentEntityLink(db, orgId, user.id, {
      documentId: id,
      entityId: body.entity_id,
    });
    if (!ok) return NextResponse.json({ error: error || "Failed to remove link" }, { status: 400 });

    const links = await listDocumentEntityLinks(db, orgId, id);
    return NextResponse.json({ links });
  } catch (err) {
    console.error("DELETE /api/documents/[id]/entity-links error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
