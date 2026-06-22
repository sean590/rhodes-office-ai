import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { presignRequestSchema, validateFileMetadata } from "@/lib/validations";

// Presigning is one storage call per file. A bulk upload (up to 100 files)
// would time out if these ran serially — give headroom and run them in parallel.
export const maxDuration = 60;

type PresignedUrl = {
  originalName: string;
  safeName: string;
  storagePath: string;
  signedUrl: string;
  token: string;
};
type RejectedFile = { filename: string; reason: string };

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

    // One storage call per file, run in PARALLEL. Serially presigning a
    // 52-file batch timed the route out (the upload's onDrop presign fetch
    // died with nothing registered).
    const results = await Promise.all(
      parsed.data.files.map(
        async (file): Promise<{ url?: PresignedUrl; rejected?: RejectedFile }> => {
          const check = validateFileMetadata(file.name, file.size, file.type);
          if (!check.valid) {
            return { rejected: { filename: file.name, reason: check.error } };
          }
          const safeName = file.name.replace(/[^a-zA-Z0-9\-_. ]/g, "_");
          const storagePath = `${orgId}/queue/${batchId}/${safeName}`;
          const { data, error } = await admin.storage
            .from("documents")
            .createSignedUploadUrl(storagePath, { upsert: true });
          if (error || !data) {
            return {
              rejected: { filename: file.name, reason: `Failed to create upload URL: ${error?.message ?? "unknown"}` },
            };
          }
          return {
            url: { originalName: file.name, safeName, storagePath, signedUrl: data.signedUrl, token: data.token },
          };
        },
      ),
    );
    const urls = results.flatMap((r) => (r.url ? [r.url] : []));
    const rejected = results.flatMap((r) => (r.rejected ? [r.rejected] : []));

    return NextResponse.json({ urls, rejected });
  } catch (err) {
    console.error("POST /api/pipeline/batches/[batchId]/presign error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
