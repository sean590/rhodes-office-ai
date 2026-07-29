import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { logAuditEvent, getRequestContext } from "@/lib/utils/audit";
import { headers } from "next/headers";

const bodySchema = z.object({
  // dismissed: "I handled it / not relevant". resolved: "the document made it
  // into Rhodes another way" (forwarded or uploaded manually).
  action: z.enum(["dismissed", "resolved"]),
});

// POST /api/inbound/[id]/resolve — close out a needs_user (or failed) inbound
// delivery from the visibility surface.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const db = createOrgClient(orgId);
    const { data: row, error } = await db
      .from("inbound_deliveries")
      .update({ status: parsed.data.action, updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("status", ["needs_user", "failed"])
      .select("id, status")
      .maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: "Not found or not resolvable" }, { status: 404 });

    const reqCtx = getRequestContext(await headers(), orgId);
    await logAuditEvent({
      userId: user.id,
      action: "inbound_" + parsed.data.action,
      resourceType: "inbound_delivery",
      resourceId: id,
      metadata: {},
      ...reqCtx,
    });

    return NextResponse.json(row);
  } catch (err) {
    console.error("POST /api/inbound/[id]/resolve error:", err);
    return NextResponse.json({ error: "Failed to update inbound delivery" }, { status: 500 });
  }
}
