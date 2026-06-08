import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

/**
 * GET /api/home/staged — pending agent-staged chat actions for the current
 * user (the Home "Approve" group). An action is pending if it sits in a chat
 * message's metadata.staged_actions and is NOT yet resolved in that message's
 * applied_statuses. Each item carries its session_id so the UI can approve it
 * through /api/chat/apply-actions.
 */
export async function GET() {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const admin = createAdminClient();

    // The user's recent chat sessions in this org.
    const { data: sessions } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(40);
    const sessionIds = (sessions ?? []).map((s) => s.id);
    if (sessionIds.length === 0) return NextResponse.json([]);

    // Recent assistant messages that staged write actions.
    const { data: messages } = await admin
      .from("chat_messages")
      .select("id, session_id, metadata, created_at")
      .in("session_id", sessionIds)
      .not("metadata->staged_actions", "is", null)
      .order("created_at", { ascending: false })
      .limit(60);

    const TERMINAL = new Set(["applied", "rejected", "failed"]);
    const out: Array<Record<string, unknown>> = [];
    for (const m of messages ?? []) {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      const staged = (meta.staged_actions as Array<Record<string, unknown>>) ?? [];
      const applied = (meta.applied_statuses as Record<string, string>) ?? {};
      for (const a of staged) {
        const id = a.id as string;
        if (TERMINAL.has(applied[id])) continue; // already resolved
        out.push({
          session_id: m.session_id,
          message_id: m.id,
          id,
          tool: a.tool,
          input: a.input,
          summary: a.summary,
          staged_at: m.created_at,
        });
      }
    }

    return NextResponse.json(out);
  } catch (err) {
    console.error("GET /api/home/staged error:", err);
    return NextResponse.json({ error: "Failed to load staged actions" }, { status: 500 });
  }
}
