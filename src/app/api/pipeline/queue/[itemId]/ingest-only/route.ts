/**
 * POST /api/pipeline/queue/[itemId]/ingest-only
 *
 * Historical: under the proposal model, "Ingest only" meant "file the
 * document but skip the AI's proposed actions." Under the agent model,
 * actions are applied inline by tool calls; there's nothing to skip.
 * Both this route and /approve now collapse to the same primitive
 * (`fileQueueItem`) — kept as a separate URL so legacy callers don't
 * break, deprecated for new use.
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
      queue_item_id: result.item?.id ?? itemId,
      document_id: result.documentId,
      already_filed: result.noop ?? false,
    });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/ingest-only error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
