import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: session, error: sessionError } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("id", id)
      .single();

    if (sessionError) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const { data: messages, error: messagesError } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json({ error: messagesError.message }, { status: 500 });
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
