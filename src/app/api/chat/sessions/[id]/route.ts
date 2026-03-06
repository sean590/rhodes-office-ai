import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const { id } = await params;
    const admin = createAdminClient();

    const { data: session, error: sessionError } = await admin
      .from("chat_sessions")
      .select("*")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();

    if (sessionError) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const { data: messages, error: messagesError } = await admin
      .from("chat_messages")
      .select("id, session_id, role, content, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (messagesError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({
      ...session,
      messages: messages || [],
    });
  } catch (err) {
    console.error("GET /api/chat/sessions/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
