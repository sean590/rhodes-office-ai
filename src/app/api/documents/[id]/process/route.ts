import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDocumentAgent } from "@/lib/pipeline/document-agent";
import { rateLimit } from "@/lib/utils/rate-limit";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";

export const maxDuration = 180;

/**
 * Re-run the document agent against an existing documents row. Used by the
 * "Reprocess" action on a single document. The agent reads the file, calls
 * tools to identify the entity / investment / transactions, and applies
 * write actions inline (link_*, update_*, record_*) — same flow as a fresh
 * upload, just without the queue layer.
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
    const admin = createAdminClient();

    if (!(await rateLimit(`process:${user.id}`, 10, 60000))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { data: doc, error: docError } = await admin
      .from("documents")
      .select("id, name, file_path, mime_type, organization_id")
      .eq("id", id)
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const { data: fileData, error: downloadError } = await admin.storage
      .from("documents")
      .download(doc.file_path);

    if (downloadError || !fileData) {
      return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
    }

    const fileBuffer = Buffer.from(await (fileData as Blob).arrayBuffer());

    const result = await runDocumentAgent({
      queueItemId: `reprocess-${id}`,
      documentId: id,
      orgId,
      fileBuffer,
      mimeType: doc.mime_type,
      filename: doc.name,
    });

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "process",
      resourceType: "document",
      resourceId: id,
      metadata: {
        agent_status: result.status,
        tool_call_count: result.toolCalls.length,
        tokens_used: result.tokensUsed,
      },
      ...reqCtx,
    });

    return NextResponse.json({
      status: result.status,
      summary: result.summary,
      defer_reason: result.deferReason,
      tool_calls: result.toolCalls.length,
      tokens_used: result.tokensUsed,
    });
  } catch (err) {
    Sentry.withScope((scope) => {
      scope.setTag("feature", "extraction");
      scope.setExtra("route", "documents/[id]/process");
      Sentry.captureException(err);
    });
    console.error("POST /api/documents/[id]/process error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
