import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyByFilename, matchEntityByHint, guessDirection } from "@/lib/pipeline/classify";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { registerUploadSchema } from "@/lib/validations";

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { batchId } = await params;
    const admin = createAdminClient();

    // Verify batch exists
    const { data: batch, error: batchError } = await admin
      .from("document_batches")
      .select("id, entity_id, entity_discovery")
      .eq("id", batchId)
      .eq("organization_id", orgId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Accept JSON metadata (files already uploaded directly to Supabase Storage)
    const body = await request.json();
    const parsed = registerUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const files = parsed.data.files;
    const expectedPrefix = `${orgId}/queue/${batchId}/`;

    // Validate all storage paths belong to this org/batch
    for (const file of files) {
      if (!file.storagePath.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
      }
    }

    // Get entities for matching (only if no entity_id on batch)
    let entities: Array<{ id: string; name: string; short_name: string | null }> = [];
    let batchEntityName: string | null = null;
    if (batch.entity_id) {
      const { data } = await admin
        .from("entities")
        .select("name")
        .eq("id", batch.entity_id)
        .single();
      batchEntityName = data?.name || null;
    } else {
      const { data } = await admin
        .from("entities")
        .select("id, name, short_name")
        .eq("organization_id", orgId)
        .order("name");
      entities = data || [];
    }

    const uploaded: Array<Record<string, unknown>> = [];
    const duplicates: Array<{ filename: string; reason: string }> = [];

    // Batch duplicate checks
    const allHashes = files.map((f) => f.contentHash);
    const duplicateDocHashes = new Map<string, string>();
    const duplicateQueueHashes = new Map<string, string>();

    if (allHashes.length > 0) {
      const [docDupes, queueDupes] = await Promise.all([
        admin
          .from("documents")
          .select("content_hash, name")
          .in("content_hash", allHashes)
          .eq("organization_id", orgId)
          .is("deleted_at", null),
        admin
          .from("document_queue")
          .select("content_hash, original_filename")
          .in("content_hash", allHashes)
          .in("status", ["staged", "queued", "extracting", "extracted", "review_ready"]),
      ]);

      for (const doc of docDupes.data || []) {
        duplicateDocHashes.set(doc.content_hash, doc.name);
      }
      for (const q of queueDupes.data || []) {
        duplicateQueueHashes.set(q.content_hash, q.original_filename);
      }
    }

    for (const file of files) {
      const contentHash = file.contentHash;

      // Check duplicates
      const existingDocName = duplicateDocHashes.get(contentHash);
      if (existingDocName) {
        duplicates.push({
          filename: file.originalName,
          reason: `Duplicate of existing document "${existingDocName}"`,
        });
        continue;
      }

      const existingQueueName = duplicateQueueHashes.get(contentHash);
      if (existingQueueName) {
        duplicates.push({
          filename: file.originalName,
          reason: `Duplicate of queued file "${existingQueueName}"`,
        });
        continue;
      }

      // Classify by filename
      const classification = classifyByFilename(file.originalName);

      // Try to match entity
      let entityId = batch.entity_id || null;
      let entityName: string | null = null;

      if (entityId) {
        entityName = batchEntityName;
      }

      if (!entityId && classification.entity_hint) {
        const match = matchEntityByHint(classification.entity_hint, entities);
        if (match) {
          entityId = match.id;
          entityName = match.name;
        }
      }

      // Determine direction
      const direction = classification.direction || guessDirection(file.originalName, classification.document_type);

      // Create queue item
      const { data: queueItem, error: queueError } = await admin
        .from("document_queue")
        .insert({
          batch_id: batchId,
          status: 'staged',
          original_filename: file.originalName,
          file_path: file.storagePath,
          file_size: file.size,
          mime_type: file.type || null,
          content_hash: contentHash,
          staged_doc_type: classification.document_type,
          staged_entity_id: entityId,
          staged_entity_name: entityName,
          staged_year: classification.year,
          staged_category: classification.category,
          staging_confidence: classification.confidence,
          is_composite: classification.is_composite,
          ai_direction: direction,
          source_type: 'upload',
        })
        .select()
        .single();

      if (queueError) {
        console.error(`Queue insert error for ${file.originalName}:`, queueError);
        continue;
      }

      uploaded.push(queueItem);
    }

    // Update batch stats
    const { count: totalCount } = await admin
      .from("document_queue")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .not("status", "in", '("rejected","error")');

    const { count: stagedCount } = await admin
      .from("document_queue")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .eq("status", "staged");

    await admin
      .from("document_batches")
      .update({
        total_documents: totalCount || 0,
        staged_count: stagedCount || 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId);

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "upload",
      resourceType: "pipeline",
      resourceId: batchId,
      metadata: {
        file_count: files.length,
        uploaded_count: uploaded.length,
        duplicate_count: duplicates.length,
        filenames: files.map((f) => f.originalName),
      },
      ...reqCtx,
    });

    return NextResponse.json({
      uploaded: uploaded.length,
      duplicates,
      items: uploaded,
    });
  } catch (err) {
    console.error("POST /api/pipeline/batches/[batchId]/upload error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
