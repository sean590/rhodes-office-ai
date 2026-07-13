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
    const { orgId, user } = ctx;

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
      .select("id, session_id, role, content, metadata, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: true })
      .limit(500);

    if (messagesError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // Preload this user's feedback for every assistant message in the session.
    // One bounded query — saves one request per assistant bubble on the client.
    const assistantIds = (messages ?? [])
      .filter((m) => m.role === "assistant")
      .map((m) => m.id);
    const feedbackByMessageId: Record<
      string,
      { rating: "up" | "down"; comment: string | null }
    > = {};
    if (assistantIds.length > 0) {
      const { data: feedback } = await admin
        .from("chat_feedback")
        .select("message_id, rating, comment")
        .eq("user_id", user.id)
        .in("message_id", assistantIds);
      for (const f of (feedback ?? []) as Array<{
        message_id: string;
        rating: "up" | "down";
        comment: string | null;
      }>) {
        feedbackByMessageId[f.message_id] = { rating: f.rating, comment: f.comment };
      }
    }

    const messagesWithFeedback = (messages ?? []).map((m) => ({
      ...m,
      feedback: feedbackByMessageId[m.id] ?? null,
    }));

    return NextResponse.json({
      ...session,
      messages: messagesWithFeedback,
    });
  } catch (err) {
    console.error("GET /api/chat/sessions/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
