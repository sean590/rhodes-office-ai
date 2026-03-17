import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { presignRequestSchema, validateFileMetadata } from "@/lib/validations";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const { batchId } = await params;
    const admin = createAdminClient();

    // Verify batch exists
    const { data: batch, error: batchError } = await admin
      .from("document_batches")
      .select("id")
      .eq("id", batchId)
      .eq("organization_id", orgId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = presignRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const urls: Array<{
      originalName: string;
      safeName: string;
      storagePath: string;
      signedUrl: string;
      token: string;
    }> = [];
    const rejected: Array<{ filename: string; reason: string }> = [];

    for (const file of parsed.data.files) {
      const check = validateFileMetadata(file.name, file.size, file.type);
      if (!check.valid) {
        rejected.push({ filename: file.name, reason: check.error });
        continue;
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9\-_. ]/g, "_");
      const storagePath = `${orgId}/queue/${batchId}/${safeName}`;

      const { data, error } = await admin.storage
        .from("documents")
        .createSignedUploadUrl(storagePath, { upsert: true });

      if (error) {
        rejected.push({ filename: file.name, reason: `Failed to create upload URL: ${error.message}` });
        continue;
      }

      urls.push({
        originalName: file.name,
        safeName,
        storagePath,
        signedUrl: data.signedUrl,
        token: data.token,
      });
    }

    return NextResponse.json({ urls, rejected });
  } catch (err) {
    console.error("POST /api/pipeline/batches/[batchId]/presign error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
