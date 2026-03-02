import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();

    // Get batch
    const { data: batch, error: batchError } = await supabase
      .from("document_batches")
      .select("*")
      .eq("id", batchId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Get all queue items for this batch
    const { data: items, error: itemsError } = await supabase
      .from("document_queue")
      .select("*")
      .eq("batch_id", batchId)
      .order("created_at");

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Collect unique proposed entities from items
    const proposedEntities: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const item of items || []) {
      if (item.ai_proposed_entity) {
        const key = JSON.stringify(item.ai_proposed_entity);
        if (!seen.has(key)) {
          seen.add(key);
          proposedEntities.push(item.ai_proposed_entity as Record<string, unknown>);
        }
      }
    }

    // Build summary — group ingested documents by entity
    const ingestedItems = (items || []).filter(
      (i) => i.status === "auto_ingested" || i.status === "approved"
    );
    const reviewItems = (items || []).filter((i) => i.status === "review_ready");
    const errorItems = (items || []).filter((i) => i.status === "error");

    // Fetch entity names for ingested items
    const entityIds = [...new Set(ingestedItems.map((i) => i.ai_entity_id).filter(Boolean))];
    let entityNameMap: Record<string, string> = {};
    if (entityIds.length > 0) {
      const { data: entities } = await admin
        .from("entities")
        .select("id, name")
        .in("id", entityIds);
      if (entities) {
        entityNameMap = Object.fromEntries(entities.map((e) => [e.id, e.name]));
      }
    }

    // Group by entity
    const entityGroups: Record<string, {
      entity_id: string | null;
      entity_name: string;
      documents: Array<{
        id: string;
        document_id: string | null;
        name: string;
        type: string;
        type_label: string;
        year: number | null;
        status: string;
      }>;
    }> = {};

    for (const item of ingestedItems) {
      const eid = item.ai_entity_id || "unassociated";
      if (!entityGroups[eid]) {
        entityGroups[eid] = {
          entity_id: item.ai_entity_id || null,
          entity_name: item.ai_entity_id ? (entityNameMap[item.ai_entity_id] || "Unknown Entity") : "No entity assigned",
          documents: [],
        };
      }
      const docType = item.ai_document_type || item.staged_doc_type || "other";
      entityGroups[eid].documents.push({
        id: item.id,
        document_id: item.document_id,
        name: item.ai_suggested_name || item.original_filename,
        type: docType,
        type_label: DOCUMENT_TYPE_LABELS[docType] || docType,
        year: item.ai_year || item.staged_year || null,
        status: item.status,
      });
    }

    const summary = {
      total_items: (items || []).length,
      auto_ingested: (items || []).filter((i) => i.status === "auto_ingested").length,
      needs_review: reviewItems.length,
      approved: (items || []).filter((i) => i.status === "approved").length,
      rejected: (items || []).filter((i) => i.status === "rejected").length,
      errors: errorItems.length,
      processing: (items || []).filter((i) => i.status === "queued" || i.status === "extracting").length,
      entities_affected: Object.values(entityGroups).filter((g) => g.entity_id).sort((a, b) => a.entity_name.localeCompare(b.entity_name)),
      unassociated_documents: (entityGroups["unassociated"]?.documents || []),
    };

    return NextResponse.json({
      ...batch,
      items: items || [],
      proposed_entities: proposedEntities,
      summary,
    });
  } catch (err) {
    console.error("GET /api/pipeline/batches/[batchId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
