import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { dismissProviderSuggestion } from "@/lib/inbound/provider-discovery";

const bodySchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain"),
});

// POST /api/inbound/provider-suggestions/dismiss — "Not a provider" (spec §1c):
// mutes the domain's discovery suggestions for good via a kind='not_provider'
// inbound_delivery_senders row (077). Writes go through the admin client with
// the org id stamped server-side — the table has no authenticated write policy.
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const db = createOrgClient(orgId);
    await dismissProviderSuggestion(db.raw, orgId, parsed.data.domain);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/inbound/provider-suggestions/dismiss error:", err);
    return NextResponse.json({ error: "Failed to dismiss suggestion" }, { status: 500 });
  }
}
