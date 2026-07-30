import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { registerUploadSchema } from "@/lib/validations";
import { checkDocumentUploadAbuse } from "@/lib/utils/abuse-alarm";
import { registerBatchFiles } from "@/lib/pipeline/register-files";

export const maxDuration = 60;

// Registration semantics (dedup, classify, queue + doc rows, batch stats)
// live in lib/pipeline/register-files.ts, shared with the email-inbound
// worker. This route owns the HTTP concerns: auth, abuse alarm, storage-path
// validation, audit.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { batchId } = await params;

    // Accept JSON metadata (files already uploaded directly to Supabase Storage)
    const body = await request.json();
    const parsed = registerUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const files = parsed.data.files;

    // Abuse alarm: count this user's upload volume in Redis and raise a Sentry
    // alarm if it crosses the per-user threshold. In 'alert' mode (default) the
    // upload still proceeds; set ABUSE_ALARM_MODE=block to 429 over-limit users.
    const abuse = await checkDocumentUploadAbuse({
      orgId,
      userId: user.id,
      count: files.length,
      context: { batch_id: batchId, route: "pipeline/batches/upload" },
    });
    if (!abuse.allowed) {
      return NextResponse.json(
        { error: "Upload rate limit exceeded. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    // Validate all storage paths belong to this org/batch
    const expectedPrefix = `${orgId}/queue/${batchId}/`;
    for (const file of files) {
      if (!file.storagePath.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
      }
    }

    let result;
    try {
      result = await registerBatchFiles({ orgId, userId: user.id, batchId, files });
    } catch (err) {
      if (err instanceof Error && err.message === "Batch not found") {
        return NextResponse.json({ error: "Batch not found" }, { status: 404 });
      }
      throw err;
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "upload",
      resourceType: "pipeline",
      resourceId: batchId,
      metadata: {
        file_count: files.length,
        uploaded_count: result.uploaded.length,
        duplicate_count: result.duplicates.length,
        filenames: files.map((f) => f.originalName),
      },
      ...reqCtx,
    });

    return NextResponse.json({
      uploaded: result.uploaded.length,
      duplicates: result.duplicates,
      items: result.uploaded,
    });
  } catch (err) {
    console.error("POST /api/pipeline/batches/[batchId]/upload error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
