import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { getOrgSendSuggestions } from "@/lib/providers/routing-rules";

// GET /api/provider-sends/suggestions — proactive "Suggested sends": recent
// documents grouped into bundle suggestions per provider. Lazy-computed.
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const supabase = await createClient();
    const suggestions = await getOrgSendSuggestions(supabase, orgId);
    return NextResponse.json(suggestions);
  } catch (err) {
    console.error("GET /api/provider-sends/suggestions error:", err);
    return NextResponse.json({ error: "Failed to load send suggestions" }, { status: 500 });
  }
}
