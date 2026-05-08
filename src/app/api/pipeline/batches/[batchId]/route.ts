import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const { batchId } = await params;
    const admin = createAdminClient();

    // Get batch
    const { data: batch, error: batchError } = await admin
      .from("document_batches")
      .select("*")
      .eq("id", batchId)
      .eq("organization_id", orgId)
      .single();

    if (batchError || !batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    // Get all queue items for this batch
    const { data: items, error: itemsError } = await admin
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

    // Enrich ingested rows with the linkage chain the agent established:
    //   investment + transaction + amount + date.
    // Without this, /review's batch view only shows entity + doc-type, leaving
    // the user guessing whether the agent actually filed things correctly.
    // Pull all the foreign-key joins in two batched queries.
    const ingestedDocIds = ingestedItems
      .map((i) => i.document_id as string | null)
      .filter((id): id is string => !!id);

    const docInvestmentMap: Record<string, { investment_id: string | null; investment_name: string | null }> = {};
    const docTxnSummaryMap: Record<string, string> = {};

    if (ingestedDocIds.length > 0) {
      // Documents → investment join. We surface investment name on the row
      // so the user can see at a glance which deal each doc was filed under.
      const { data: docRows } = await admin
        .from("documents")
        .select("id, investment_id, investments(id, name)")
        .in("id", ingestedDocIds);
      // Supabase types the relation as an array even when the FK is to-one.
      // Treat it as a one-element list (or null) defensively.
      for (const d of (docRows ?? []) as unknown as Array<{
        id: string;
        investment_id: string | null;
        investments: Array<{ id: string; name: string }> | { id: string; name: string } | null;
      }>) {
        const inv = Array.isArray(d.investments) ? d.investments[0] : d.investments;
        docInvestmentMap[d.id] = {
          investment_id: d.investment_id,
          investment_name: inv?.name ?? null,
        };
      }

      // Transactions where document_id matches one of our docs. One doc per
      // txn (UI shows the most recent if multiple). Format: "Distribution
      // $X · Y/Y/YYYY".
      const { data: txnRows } = await admin
        .from("investment_transactions")
        .select("id, document_id, transaction_type, amount, transaction_date")
        .in("document_id", ingestedDocIds)
        .order("transaction_date", { ascending: false });
      for (const t of (txnRows ?? []) as Array<{
        id: string;
        document_id: string;
        transaction_type: string;
        amount: number | string;
        transaction_date: string;
      }>) {
        if (docTxnSummaryMap[t.document_id]) continue; // first (most recent) wins
        const amt = `$${Number(t.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const typeLabel =
          t.transaction_type === "distribution"
            ? "distribution"
            : t.transaction_type === "contribution"
              ? "contribution"
              : t.transaction_type;
        docTxnSummaryMap[t.document_id] =
          `Attached to ${typeLabel} ${amt} · ${t.transaction_date}`;
      }
    }

    // Identify parent items — these are queue rows where some other item
    // has parent_queue_id === this.id. The parent is the umbrella PDF; it
    // got filed but doesn't itself belong under an investor entity. Render
    // it distinctly from genuine "no entity" leaves.
    const parentIds = new Set(
      (items ?? [])
        .map((i) => i.parent_queue_id as string | null)
        .filter((id): id is string => !!id),
    );
    const childCountByParent: Record<string, number> = {};
    for (const i of items ?? []) {
      const pid = i.parent_queue_id as string | null;
      if (pid) childCountByParent[pid] = (childCountByParent[pid] || 0) + 1;
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
        investment_name: string | null;
        transaction_summary: string | null;
        is_parent: boolean;
        child_count: number;
      }>;
    }> = {};

    for (const item of ingestedItems) {
      const isParent = parentIds.has(item.id);
      // The parent umbrella PDF goes into a dedicated bucket so the UI can
      // label it "Source PDF (split into N)" instead of "No entity assigned".
      const eid = isParent ? "__parent__" : item.ai_entity_id || "unassociated";
      if (!entityGroups[eid]) {
        entityGroups[eid] = {
          entity_id: isParent ? null : item.ai_entity_id || null,
          entity_name: isParent
            ? "Source PDFs"
            : item.ai_entity_id
              ? (entityNameMap[item.ai_entity_id] || "Unknown Entity")
              : "No entity assigned",
          documents: [],
        };
      }
      const docType = item.ai_document_type || item.staged_doc_type || "other";
      const inv = item.document_id ? docInvestmentMap[item.document_id as string] : null;
      const txnSummary = item.document_id ? docTxnSummaryMap[item.document_id as string] : null;
      entityGroups[eid].documents.push({
        id: item.id,
        document_id: item.document_id,
        name: item.ai_suggested_name || item.original_filename,
        type: docType,
        type_label: DOCUMENT_TYPE_LABELS[docType] || docType,
        year: item.ai_year || item.staged_year || null,
        status: item.status,
        investment_name: inv?.investment_name ?? null,
        transaction_summary: txnSummary ?? null,
        is_parent: isParent,
        child_count: isParent ? (childCountByParent[item.id] ?? 0) : 0,
      });
    }

    // Duplicates detected at register time — persisted to batch.metadata so
    // they're visible after page reload. Lift onto the summary so the UI
    // can render "X already filed" without poking into raw metadata.
    const batchMetadata = (batch.metadata ?? {}) as {
      duplicates?: Array<{ filename: string; reason: string; existing_document_id?: string | null }>;
    };
    const duplicates = Array.isArray(batchMetadata.duplicates) ? batchMetadata.duplicates : [];

    const summary = {
      total_items: (items || []).length,
      auto_ingested: (items || []).filter((i) => i.status === "auto_ingested").length,
      needs_review: reviewItems.length,
      approved: (items || []).filter((i) => i.status === "approved").length,
      rejected: (items || []).filter((i) => i.status === "rejected").length,
      errors: errorItems.length,
      processing: (items || []).filter((i) => i.status === "queued" || i.status === "extracting").length,
      duplicates,
      entities_affected: Object.values(entityGroups).filter((g) => g.entity_id).sort((a, b) => a.entity_name.localeCompare(b.entity_name)),
      unassociated_documents: entityGroups["unassociated"]?.documents || [],
      parent_documents: entityGroups["__parent__"]?.documents || [],
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
