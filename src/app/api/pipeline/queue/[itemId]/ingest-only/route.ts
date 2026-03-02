import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ingestQueueItem } from "@/lib/pipeline/ingest";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const supabase = await createClient();
    const admin = createAdminClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userRow } = await admin
      .from("users")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    const userId = userRow ? user.id : null;

    const { data: item, error: itemError } = await admin
      .from("document_queue")
      .select("*")
      .eq("id", itemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json({ error: "Queue item not found" }, { status: 404 });
    }

    if (item.status !== "review_ready") {
      return NextResponse.json({ error: `Cannot ingest item in status: ${item.status}` }, { status: 400 });
    }

    const result = await ingestQueueItem({
      item,
      userId,
      applyMutations: false,
      finalStatus: "approved",
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      status: "approved",
      document: result.document,
      actions_applied: 0,
      actions_failed: 0,
    });
  } catch (err) {
    console.error("POST /api/pipeline/queue/[itemId]/ingest-only error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
