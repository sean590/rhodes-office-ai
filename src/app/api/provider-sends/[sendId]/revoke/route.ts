import { NextResponse } from "next/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { applyActions } from "@/lib/pipeline/apply";

// POST /api/provider-sends/[sendId]/revoke — kill a secure share link. After
// this, the share page returns the generic "no longer available" message.
// Org-scoped via the action's organization_id filter.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sendId: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { sendId } = await params;

    const { results } = await applyActions(
      [{ action: "revoke_provider_send", data: { send_id: sendId } }],
      { orgId, userId: user.id },
    );
    const r = results[0];
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? "Failed to revoke" }, { status: 500 });
    }

    return NextResponse.json(r.data);
  } catch (err) {
    console.error("POST /api/provider-sends/[sendId]/revoke error:", err);
    return NextResponse.json({ error: "Failed to revoke link" }, { status: 500 });
  }
}
