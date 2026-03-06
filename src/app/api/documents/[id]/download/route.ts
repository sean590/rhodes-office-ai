import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id } = await params;
    const admin = createAdminClient();

    // Get document record
    const { data: doc, error } = await admin
      .from("documents")
      .select("file_path, name, mime_type")
      .eq("id", id)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .single();

    if (error || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Generate signed URL using admin client to bypass RLS (valid for 60 minutes)
    const { data: signedUrl, error: signError } = await admin.storage
      .from("documents")
      .createSignedUrl(doc.file_path, 3600);

    if (signError || !signedUrl) {
      return NextResponse.json({ error: "Failed to generate download URL" }, { status: 500 });
    }

    // Audit log (downloads are audited even though this is a GET)
    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "download",
      resourceType: "document",
      resourceId: id,
      metadata: { name: doc.name },
      ...reqCtx,
    });

    return NextResponse.json({ url: signedUrl.signedUrl, name: doc.name, mime_type: doc.mime_type });
  } catch (err) {
    console.error("GET /api/documents/[id]/download error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
