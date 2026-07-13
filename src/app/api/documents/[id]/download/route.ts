import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";

/**
 * Download a document. Always redirects (302) to a short-lived signed URL
 * pointing at the actual file in Supabase Storage. Callers should treat
 * this as a navigable URL — anchor href, window.open, or fetch+follow.
 *
 * Audit log fires before redirect so the download is recorded even if the
 * browser doesn't follow.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { id } = await params;
    // Org-scoped client: .from("documents") auto-applies organization_id = orgId,
    // so this query physically cannot reach another org's document. Storage has
    // no org column, so the signed-URL call below uses .raw (the escape hatch).
    const db = createOrgClient(orgId);

    const { data: doc, error } = await db
      .from("documents")
      .select("file_path, name, mime_type")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { data: signedUrl, error: signError } = await db.raw.storage
      .from("documents")
      // Short TTL: a copied/leaked signed URL stays valid only briefly. 120s is
      // ample to follow the redirect; 3600s left financial docs reachable an hour.
      .createSignedUrl(doc.file_path, 120);

    if (signError || !signedUrl) {
      return NextResponse.json({ error: "Failed to generate download URL" }, { status: 500 });
    }

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

    // no-store so the short-lived signed URL isn't cached in the browser/proxies.
    const res = NextResponse.redirect(signedUrl.signedUrl, 302);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("GET /api/documents/[id]/download error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
