import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";

// GET /api/notes/people?q=jane — lightweight people/contact search for the
// note attach-picker ("who did you speak with"). Returns directory entries
// (the unified People registry) matching the query. RLS-scoped.
export const maxDuration = 15;

export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const q = (new URL(request.url).searchParams.get("q") || "").trim();
    const db = await createClient();
    let query = db
      .from("directory_entries")
      .select("id, name, type")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("name")
      .limit(20);
    if (q) query = query.ilike("name", `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("GET /api/notes/people error:", err);
    return NextResponse.json({ error: "Failed to search people" }, { status: 500 });
  }
}
