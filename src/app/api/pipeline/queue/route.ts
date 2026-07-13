/**
 * GET /api/pipeline/queue?status=review_ready&limit=100
 *
 * Returns a flat list of queue items across all batches in the caller's org.
 * Used by the /review page to render the aggregated pending-actions queue
 * (no need to click into individual batch pages one by one).
 *
 * Each row is enriched with:
 *   - document name (ai_suggested_name preferred, falls back to filename)
 *   - document type label (DOCUMENT_TYPE_LABELS lookup)
 *   - entity name (resolved via ai_entity_id)
 *   - the source batch's id, name, context, and created_at
 *
 * Defaults to status=review_ready since that's the actionable status. Other
 * statuses are accepted for completeness (e.g., "queued" or "extracting" for
 * a "what's processing?" view).
 */

import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { requireOrg, isError } from "@/lib/utils/org-context";

const ALLOWED_STATUSES = new Set([
  "queued",
  "extracting",
  "review_ready",
  "approved",
  "auto_ingested",
  "rejected",
  "error",
  "password_required",
]);

interface BatchRow {
  id: string;
  name: string | null;
  context: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

interface QueueRow {
  id: string;
  batch_id: string;
  document_id: string | null;
  status: string;
  original_filename: string;
  ai_suggested_name: string | null;
  ai_document_type: string | null;
  staged_doc_type: string | null;
  ai_entity_id: string | null;
  staged_entity_id: string | null;
  ai_year: number | null;
  staged_year: number | null;
  ai_confidence: number | null;
  ai_proposed_actions: unknown;
  ai_proposed_entities: unknown;
  ai_summary: string | null;
  approval_reason: string | null;
  extraction_error: string | null;
  created_at: string;
  chat_session_id: string | null;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const url = new URL(request.url);
    // Accepts a single status ("review_ready") or a comma-separated set
    // ("queued,extracting,error") so the Processing surface can pull every
    // in-flight + recently-resolved state in one round-trip.
    const statusParam = url.searchParams.get("status") || "review_ready";
    const statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 0 || statuses.some((s) => !ALLOWED_STATUSES.has(s))) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam ? Number(limitParam) : 100;
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 500)
      : 100;

    const db = createOrgClient(orgId);

    // Step 1: org-scoped batch ids. Filtering through a join on
    // document_batches.organization_id keeps the queue scan narrow.
    const { data: batches, error: batchesErr } = await db
      .from("document_batches")
      .select("id, name, context, created_at, metadata");
    if (batchesErr) {
      console.error("List batches for queue error:", batchesErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    const batchMap = new Map<string, BatchRow>();
    for (const b of (batches || []) as BatchRow[]) batchMap.set(b.id, b);
    const batchIds = Array.from(batchMap.keys());
    if (batchIds.length === 0) return NextResponse.json([]);

    // Step 2: queue rows in the requested status, scoped to those batches.
    const { data: items, error: itemsErr } = await db
      .from("document_queue")
      .select(
        "id, batch_id, document_id, status, original_filename, ai_suggested_name, ai_document_type, staged_doc_type, ai_entity_id, staged_entity_id, ai_year, staged_year, ai_confidence, ai_proposed_actions, ai_proposed_entities, ai_summary, approval_reason, extraction_error, created_at, chat_session_id",
      )
      .in("status", statuses)
      .in("batch_id", batchIds)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (itemsErr) {
      console.error("List queue items error:", itemsErr);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Step 3: resolve entity names for the items (single round-trip).
    const entityIds = Array.from(
      new Set(
        ((items as QueueRow[] | null) || [])
          .map((i) => i.ai_entity_id || i.staged_entity_id)
          .filter((id): id is string => !!id),
      ),
    );
    const entityNameMap: Record<string, string> = {};
    if (entityIds.length > 0) {
      const { data: entities } = await db
        .from("entities")
        .select("id, name")
        .in("id", entityIds);
      for (const e of entities || []) entityNameMap[e.id] = e.name;
    }

    const enriched = ((items as QueueRow[] | null) || []).map((i) => {
      const docType = i.ai_document_type || i.staged_doc_type || null;
      const entityId = i.ai_entity_id || i.staged_entity_id;
      const batch = batchMap.get(i.batch_id);
      // Legacy: drop _silent confirmations from old extract→classifier
      // queue items. New items from the document agent never set this
      // field — actions are applied inline via tool calls — but historical
      // rows may still carry it.
      const allProposedActions = Array.isArray(i.ai_proposed_actions)
        ? (i.ai_proposed_actions as Array<{ action: string; data?: Record<string, unknown>; reason?: string; _silent?: boolean }>)
        : [];
      const proposedActions = allProposedActions.filter((a) => !a._silent);
      return {
        id: i.id,
        batch_id: i.batch_id,
        document_id: i.document_id,
        chat_session_id: i.chat_session_id,
        status: i.status,
        document_name: i.ai_suggested_name || i.original_filename,
        document_type: docType,
        // Title-case any code not in the map so a raw slug ("services_agreement")
        // never reaches the UI — same fallback the entity surfaces use.
        document_type_label: docType
          ? (DOCUMENT_TYPE_LABELS[docType] ?? docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
          : null,
        entity_id: entityId,
        entity_name: entityId ? (entityNameMap[entityId] ?? null) : null,
        year: i.ai_year || i.staged_year || null,
        ai_confidence: i.ai_confidence,
        proposed_actions: proposedActions,
        proposed_actions_count: proposedActions.length,
        ai_summary: i.ai_summary,
        approval_reason: i.approval_reason,
        extraction_error: i.extraction_error,
        created_at: i.created_at,
        batch: batch
          ? {
              id: batch.id,
              name: batch.name,
              context: batch.context,
              created_at: batch.created_at,
              session_id: (batch.metadata as { session_id?: string } | null)?.session_id ?? null,
            }
          : null,
      };
    });

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("GET /api/pipeline/queue error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
