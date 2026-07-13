import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { getProviderSuggestions } from "@/lib/providers/suggestions";

// GET /api/documents/[id]/provider-suggestions — providers that serve the
// document's entity, ranked by discipline relevance. Soft ranking, never filters.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;
    const { id } = await params;

    const supabase = await createClient();
    const suggestions = await getProviderSuggestions(supabase, orgId, id);
    return NextResponse.json(suggestions);
  } catch (err) {
    console.error("GET /api/documents/[id]/provider-suggestions error:", err);
    return NextResponse.json({ error: "Failed to load provider suggestions" }, { status: 500 });
  }
}
