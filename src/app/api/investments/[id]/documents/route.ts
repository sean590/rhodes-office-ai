import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError, validateInvestmentOrg } from "@/lib/utils/org-context";

/**
 * GET /api/investments/[id]/documents
 *
 * Returns documents associated with an investment.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const isValid = await validateInvestmentOrg(id, orgId);
    if (!isValid) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    const db = createOrgClient(orgId);

    const { data, error } = await db
      .from("documents")
      .select("id, entity_id, investment_id, name, document_type, document_category, year, file_path, file_size, mime_type, created_at, ai_extraction")
      .eq("investment_id", id)
      .is("deleted_at", null)
      .order("document_category", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET investment documents error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (err) {
    console.error("GET /api/investments/[id]/documents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
