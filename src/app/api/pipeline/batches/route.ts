import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { createBatchSchema } from "@/lib/validations";
import { headers } from "next/headers";
import { requireOrg, isError } from "@/lib/utils/org-context";

// GET /api/pipeline/batches?limit=10
// Returns recent batches for the caller's org, newest first. Used by the
// NotificationBell in the header.
export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const url = new URL(request.url);
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam ? Number(limitParam) : 10;
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 10;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("document_batches")
      .select("id, name, source_type, status, context, total_documents, metadata, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("List batches error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // For batches that are still being processed, compute a live progress
    // breakdown from document_queue. The worker only writes the rolled-up
    // stat columns once at the end of processBatch, so we derive per-item
    // progress from the queue rows instead. Only do this for in-progress
    // batches — completed batches don't need a live count.
    const rows = (data || []) as Array<{
      id: string;
      status: string;
      total_documents: number;
      [k: string]: unknown;
    }>;
    const inProgressIds = rows
      .filter((b) => b.status === "staging" || b.status === "processing")
      .map((b) => b.id);

    const progressByBatch = new Map<string, { processed: number; total: number }>();
    if (inProgressIds.length > 0) {
      const { data: queueRows } = await admin
        .from("document_queue")
        .select("batch_id, status")
        .in("batch_id", inProgressIds);
      const PENDING = new Set(["staged", "queued", "extracting"]);
      for (const r of (queueRows || []) as Array<{ batch_id: string; status: string }>) {
        const acc = progressByBatch.get(r.batch_id) ?? { processed: 0, total: 0 };
        acc.total += 1;
        if (!PENDING.has(r.status)) acc.processed += 1;
        progressByBatch.set(r.batch_id, acc);
      }
    }

    const enriched = rows.map((b) => {
      const p = progressByBatch.get(b.id);
      return p ? { ...b, progress: p } : b;
    });

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("GET /api/pipeline/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const admin = createAdminClient();

    const body = await request.json();
    const parsed = createBatchSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstError?.message || "Invalid input" },
        { status: 400 }
      );
    }
    const { name, context, entity_id, entity_discovery, metadata: batchMetadata } = parsed.data;

    // Check if user exists in public users table (auth user may not be synced yet)
    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    const { data, error } = await admin
      .from("document_batches")
      .insert({
        name: name || null,
        context,
        entity_id: entity_id || null,
        entity_discovery,
        metadata: batchMetadata ?? {},
        created_by: userRow ? user.id : null,
        organization_id: orgId,
      })
      .select()
      .single();

    if (error) {
      console.error("Create batch error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);
    await logAuditEvent({
      userId: user.id,
      action: "create_batch",
      resourceType: "pipeline",
      resourceId: data.id,
      metadata: { context, entity_id: entity_id || null },
      ...reqCtx,
    });

    return NextResponse.json(data);
  } catch (err) {
    console.error("POST /api/pipeline/batches error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
