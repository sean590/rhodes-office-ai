import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";

// GET /api/service-providers/[id]/sends — the document send log for a provider,
// with document names joined.
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

    const { data: sends, error } = await supabase
      .from("provider_document_sends")
      .select("id, document_id, entity_id, recipient_email, subject, status, delivery_provider, error, share_token, expires_at, revoked_at, sent_at, created_at")
      .eq("organization_id", orgId)
      .eq("provider_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    if (!sends || sends.length === 0) {
      return NextResponse.json([]);
    }

    const sendIds = sends.map((s) => s.id);
    const docIds = [...new Set(sends.map((s) => s.document_id))];

    // Join document names + the access trail in parallel.
    const [{ data: docs }, { data: access }] = await Promise.all([
      supabase.from("documents").select("id, name").eq("organization_id", orgId).in("id", docIds),
      supabase
        .from("provider_document_send_access")
        .select("send_id, action, claimed_email, created_at")
        .eq("organization_id", orgId)
        .in("send_id", sendIds)
        .order("created_at", { ascending: false }),
    ]);

    const nameById = new Map<string, string>();
    for (const d of docs ?? []) nameById.set(d.id, d.name);

    // Aggregate access per send: counts + the most recent downloader email.
    const trail = new Map<string, { viewed: number; downloaded: number; last_downloaded_email: string | null; last_access_at: string | null }>();
    for (const a of access ?? []) {
      const t = trail.get(a.send_id) ?? { viewed: 0, downloaded: 0, last_downloaded_email: null, last_access_at: null };
      if (a.action === "viewed") t.viewed += 1;
      if (a.action === "downloaded") {
        t.downloaded += 1;
        if (!t.last_downloaded_email && a.claimed_email) t.last_downloaded_email = a.claimed_email;
      }
      if (!t.last_access_at) t.last_access_at = a.created_at; // rows are desc, first wins
      trail.set(a.send_id, t);
    }

    return NextResponse.json(
      sends.map((s) => ({
        ...s,
        document_name: nameById.get(s.document_id) ?? null,
        access: trail.get(s.id) ?? { viewed: 0, downloaded: 0, last_downloaded_email: null, last_access_at: null },
      })),
    );
  } catch (err) {
    console.error("GET /api/service-providers/[id]/sends error:", err);
    return NextResponse.json({ error: "Failed to fetch send history" }, { status: 500 });
  }
}
