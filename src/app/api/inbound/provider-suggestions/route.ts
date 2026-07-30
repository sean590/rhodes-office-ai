import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { listProviderSuggestions } from "@/lib/inbound/provider-discovery";

// GET /api/inbound/provider-suggestions — repeated delivery-looking senders
// with no matched provider (spec §1c). Powers the "Add {Firm} as a provider?"
// cards on Home's Suggested lane.
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;
    const db = createOrgClient(orgId);

    const suggestions = await listProviderSuggestions(db.raw, orgId);
    return NextResponse.json(suggestions);
  } catch (err) {
    console.error("GET /api/inbound/provider-suggestions error:", err);
    return NextResponse.json({ error: "Failed to load provider suggestions" }, { status: 500 });
  }
}
