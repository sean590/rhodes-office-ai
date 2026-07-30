import { NextResponse } from "next/server";
import { createOrgClient } from "@/lib/supabase/org-client";
import { requireOrg, isError } from "@/lib/utils/org-context";

// GET /api/inbound — the mailbox feed: every triaged inbound email and its
// disposition, newest first. Powers the inbound visibility surface (usable-bar
// item 1). Documents are joined so ingested rows can link straight to them.
export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;
    const db = createOrgClient(orgId);

    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    // Ignored rows are noise — excluded unless explicitly requested.
    const includeIgnored = url.searchParams.get("include_ignored") === "true";

    let q = db
      .from("inbound_deliveries")
      .select("id, sender, subject, received_at, classification, status, provider_id, batch_id, document_ids, needs_user_reason, error, created_at")
      .order("received_at", { ascending: false })
      .limit(limit);
    if (!includeIgnored) q = q.neq("status", "ignored");
    const { data: rows, error } = await q;
    if (error) throw error;

    // Join document names for ingested/retrieved rows.
    const docIds = Array.from(new Set((rows ?? []).flatMap((r: { document_ids: string[] | null }) => r.document_ids ?? [])));
    const docNames = new Map<string, { name: string; status: string }>();
    if (docIds.length > 0) {
      const { data: docs } = await db
        .from("documents")
        .select("id, name, status")
        .in("id", docIds)
        .is("deleted_at", null);
      for (const d of docs ?? []) docNames.set(d.id as string, { name: d.name as string, status: d.status as string });
    }

    return NextResponse.json(
      (rows ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        documents: ((r.document_ids as string[]) ?? [])
          .map((id) => ({ id, ...docNames.get(id) }))
          .filter((d) => d.name),
      })),
    );
  } catch (err) {
    console.error("GET /api/inbound error:", err);
    return NextResponse.json({ error: "Failed to load inbound mail" }, { status: 500 });
  }
}
