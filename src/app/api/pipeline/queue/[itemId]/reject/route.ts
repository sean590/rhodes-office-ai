/**
 * POST /api/pipeline/queue/[itemId]/reject
 *
 * Thin wrapper around `rejectQueueItem`. Same primitive as the
 * `reject_queue_item` MCP tool.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectQueueItem } from "@/lib/pipeline/queue-actions";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { getRequestContext } from "@/lib/utils/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const { itemId } = await params;
    const admin = createAdminClient();

    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : null;

    const reqHeaders = await headers();
    const reqCtx = getRequestContext(reqHeaders, orgId);

    const result = await rejectQueueItem(
      itemId,
      {
        orgId,
        userId: userRow ? user.id : null,
        requestContext: reqCtx,
      },
      reason,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      status: "rejected",
      queue_item_id: result.item.id,
      reason,
    });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/reject error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
