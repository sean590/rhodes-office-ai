import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();

    // Get document record
    const { data: doc, error } = await supabase
      .from("documents")
      .select("file_path, name, mime_type")
      .eq("id", id)
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
    const { data: { user } } = await supabase.auth.getUser();
    const reqHeaders = await headers();
    const ctx = getRequestContext(reqHeaders);
    await logAuditEvent({
      userId: user?.id ?? null,
      action: "download",
      resourceType: "document",
      resourceId: id,
      metadata: { name: doc.name },
      ...ctx,
    });

    return NextResponse.json({ url: signedUrl.signedUrl, name: doc.name, mime_type: doc.mime_type });
  } catch (err) {
    console.error("GET /api/documents/[id]/download error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
