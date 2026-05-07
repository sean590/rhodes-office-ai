/**
 * POST /api/pipeline/queue/[itemId]/approve
 *
 * Thin wrapper around `fileQueueItem`. Same primitive that drives the
 * `file_queue_item` MCP tool — chat and the legacy /review bulk button
 * end up at the same place. Under the document agent, "approve" no
 * longer means "apply proposed actions" (there are none to apply); it
 * means "the agent's auto-applied writes look right, mark this item
 * filed."
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileQueueItem } from "@/lib/pipeline/queue-actions";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { getRequestContext } from "@/lib/utils/audit";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();

    // public.users may not have a row for this auth user (lazy sync on
    // first sign-in). reviewed_by FK targets public.users(id), so fall
    // back to null when missing — same pattern as reject + ingest-only.
    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);

    const result = await fileQueueItem(itemId, {
      orgId,
      userId: userRow ? user.id : null,
      requestContext: reqCtx,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      status: "approved",
      queue_item_id: result.item.id,
      document_id: result.documentId,
    });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/approve error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
