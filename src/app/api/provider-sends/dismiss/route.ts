import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { applyActions } from "@/lib/pipeline/apply";

const dismissSchema = z.object({
  provider_id: z.string().uuid(),
  document_ids: z.array(z.string().uuid()).min(1),
});

// POST /api/provider-sends/dismiss — dismiss a proactive send suggestion so it
// doesn't resurface, and decay the learned routing rule.
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const body = await request.json().catch(() => ({}));
    const parsed = dismissSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { results } = await applyActions(
      [{ action: "dismiss_send_suggestion", data: parsed.data }],
      { orgId, userId: user.id },
    );
    const r = results[0];
    if (!r?.success) {
      return NextResponse.json({ error: r?.error ?? "Failed to dismiss" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/provider-sends/dismiss error:", err);
    return NextResponse.json({ error: "Failed to dismiss suggestion" }, { status: 500 });
  }
}
