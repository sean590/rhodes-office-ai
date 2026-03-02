import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyByFilename, matchEntityByHint, guessDirection } from "@/lib/pipeline/classify";
import { requireOrg, isError } from "@/lib/utils/org-context";

async function computeHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
      .select("id, entity_id, entity_discovery")
      .eq("id", batchId)
      .eq("organization_id", orgId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Get entities for matching (only if no entity_id on batch)
    let entities: Array<{ id: string; name: string; short_name: string | null }> = [];
    if (!batch.entity_id) {
      const { data } = await admin
        .from("entities")
        .select("id, name, short_name")
        .eq("organization_id", orgId)
        .order("name");
      entities = data || [];
    }

    const uploaded: Array<Record<string, unknown>> = [];
    const duplicates: Array<{ filename: string; reason: string }> = [];

    for (const file of files) {
      const buffer = await file.arrayBuffer();
      const contentHash = await computeHash(buffer);

      // Check for duplicates in existing documents
      const { data: existingDoc } = await admin
        .from("documents")
        .select("id, name")
        .eq("content_hash", contentHash)
        .eq("organization_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

      if (existingDoc) {
        duplicates.push({
          filename: file.name,
          reason: `Duplicate of existing document "${existingDoc.name}"`,
        });
        continue;
      }

      // Check for duplicates in current queue
      const { data: existingQueue } = await admin
        .from("document_queue")
        .select("id, original_filename")
        .eq("content_hash", contentHash)
        .not("status", "in", '("rejected","error")')
        .maybeSingle();

      if (existingQueue) {
        duplicates.push({
          filename: file.name,
          reason: `Duplicate of queued file "${existingQueue.original_filename}"`,
        });
        continue;
      }

      // Upload file to storage (org-scoped path)
      const storagePath = `${orgId}/queue/${batchId}/${file.name}`;
      const { error: uploadError } = await admin.storage
        .from("documents")
        .upload(storagePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });

      if (uploadError) {
        console.error(`Upload error for ${file.name}:`, uploadError);
        duplicates.push({ filename: file.name, reason: `Upload failed: ${uploadError.message}` });
        continue;
      }

      // Classify by filename
      const classification = classifyByFilename(file.name);

      // Try to match entity
      let entityId = batch.entity_id || null;
      let entityName: string | null = null;

      if (!entityId && classification.entity_hint) {
        const match = matchEntityByHint(classification.entity_hint, entities);
        if (match) {
          entityId = match.id;
          entityName = match.name;
        }
      }

      // Determine direction
      const direction = classification.direction || guessDirection(file.name, classification.document_type);

      // Create queue item
      const { data: queueItem, error: queueError } = await admin
        .from("document_queue")
        .insert({
          batch_id: batchId,
          status: 'staged',
          original_filename: file.name,
          file_path: storagePath,
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
        console.error(`Queue insert error for ${file.name}:`, queueError);
        continue;
      }

      uploaded.push(queueItem);
    }

    // Update batch stats — query actual counts to avoid overwrite on multi-upload
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
