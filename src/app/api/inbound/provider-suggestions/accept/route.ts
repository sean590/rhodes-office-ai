import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { getRequestContext } from "@/lib/utils/audit";
import { acceptProviderSuggestion } from "@/lib/inbound/provider-discovery";

const bodySchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Invalid domain"),
  name: z.string().min(1, "Name is required").max(255),
});

// POST /api/inbound/provider-suggestions/accept — "Add to People" (spec §1c):
// create the provider from the discovered domain and retroactively attribute
// that domain's unowned inbound ledger rows.
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const db = createOrgClient(orgId);
    const reqCtx = getRequestContext(await headers(), orgId);
    const result = await acceptProviderSuggestion(
      db.raw, orgId, user.id, parsed.data.domain, parsed.data.name,
      { ipAddress: reqCtx.ipAddress, userAgent: reqCtx.userAgent },
    );

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("POST /api/inbound/provider-suggestions/accept error:", err);
    return NextResponse.json({ error: "Failed to add provider" }, { status: 500 });
  }
}
