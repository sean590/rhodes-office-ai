/**
 * POST /api/chat/sessions/[id]/messages
 *
 * Inserts a single chat_messages row directly, bypassing the MCP orchestrator.
 * Used by the batch-upload path in the chat drawer to persist the user's
 * upload message and the system-style "batch handoff" assistant message
 * without triggering Claude — those documents go through the pipeline in
 * the background, not through chat.
 *
 * Auth: caller must belong to the org that owns the session.
 *
 * No MCP tool wraps this endpoint (intentional Tier 3 exclusion) — Claude
 * should never insert raw rows into its own conversation log.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const { id: sessionId } = await params;
    const admin = createAdminClient();

    // Verify session ownership.
    const { data: session } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const role = body.role;
    if (role !== "user" && role !== "assistant") {
      return NextResponse.json(
        { error: "role must be 'user' or 'assistant'" },
        { status: 400 },
      );
    }

    const content = typeof body.content === "string" ? body.content : "";
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const metadata =
      body.metadata && typeof body.metadata === "object" ? body.metadata : null;

    const { data, error } = await admin
      .from("chat_messages")
      .insert({
        session_id: sessionId,
        role,
        content,
        metadata,
      })
      .select()
      .single();

    if (error) {
      console.error("Insert chat message error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("POST /api/chat/sessions/[id]/messages error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
