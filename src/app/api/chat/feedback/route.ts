/**
 * POST /api/chat/feedback — thumbs+comment feedback on assistant messages.
 *
 * Body (validated by chatFeedbackSchema):
 *   { message_id: uuid, rating: 'up' | 'down', comment?: string (max 2000) }
 *
 * Flow:
 *   1. requireOrg() — auth + org resolution.
 *   2. Load the referenced chat_message + its session; verify session belongs
 *      to ctx.orgId. If either lookup fails, return 404 (don't leak existence
 *      of messages that don't belong to this org).
 *   3. Assert message.role === 'assistant'. User messages can't be rated.
 *   4. Upsert on (user_id, message_id) — replaces prior rating/comment.
 *   5. Return { ok: true, feedback }.
 *
 * The admin client is used for the upsert: RLS policies would reject writes
 * under some role configs, and org isolation is already enforced by the
 * session-ownership check above.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

const chatFeedbackSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
  rating: z.enum(["up", "down"]),
  comment: z.string().max(2000).optional().nullable(),
});

const deleteFeedbackSchema = z.object({
  message_id: z.string().uuid("Invalid message ID"),
});

/** Shared helper — validates that `message_id` resolves to an assistant
 *  message whose session belongs to `orgId`. Returns the row on success, or a
 *  NextResponse error the caller should return directly. */
async function loadAssistantMessageInOrg(
  admin: ReturnType<typeof createAdminClient>,
  messageId: string,
  orgId: string,
): Promise<
  | { ok: true; message: { id: string; role: string } }
  | { ok: false; response: NextResponse }
> {
  const { data: message, error: msgErr } = await admin
    .from("chat_messages")
    .select("id, role, session_id, chat_sessions!inner(organization_id)")
    .eq("id", messageId)
    .maybeSingle();
  if (msgErr) {
    console.error("[feedback] message lookup failed", msgErr);
    return {
      ok: false,
      response: NextResponse.json({ error: "internal error" }, { status: 500 }),
    };
  }
  const sessionOrg = (message as { chat_sessions?: { organization_id: string } } | null)
    ?.chat_sessions?.organization_id;
  if (!message || sessionOrg !== orgId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "message not found" }, { status: 404 }),
    };
  }
  return { ok: true, message };
}

export async function POST(request: Request) {
  const org = await requireOrg();
  if (isError(org)) return org;
  const { user, orgId } = org;

  const body = await request.json().catch(() => ({}));
  const parsed = chatFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "invalid request body" },
      { status: 400 },
    );
  }
  const { message_id, rating, comment } = parsed.data;

  const admin = createAdminClient();

  const load = await loadAssistantMessageInOrg(admin, message_id, orgId);
  if (!load.ok) return load.response;
  if (load.message.role !== "assistant") {
    return NextResponse.json(
      { error: "feedback is only supported on assistant messages" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { data: feedback, error: upsertErr } = await admin
    .from("chat_feedback")
    .upsert(
      {
        organization_id: orgId,
        user_id: user.id,
        message_id,
        rating,
        comment: comment ?? null,
        updated_at: now,
      },
      { onConflict: "user_id,message_id" },
    )
    .select("id, message_id, rating, comment, created_at, updated_at")
    .single();
  if (upsertErr) {
    console.error("[feedback] upsert failed", upsertErr);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, feedback });
}

/**
 * DELETE /api/chat/feedback — clears the caller's feedback row for a message.
 *
 * Idempotent: deleting a row that doesn't exist returns 200. Only 404s when
 * the `message_id` doesn't resolve to a message in this org (mirrors the POST
 * existence-leak guard).
 *
 * Used by the chat UI's three-state toggle-clear: clicking a thumbs button
 * that's already in the active rating removes the feedback entirely.
 */
export async function DELETE(request: Request) {
  const org = await requireOrg();
  if (isError(org)) return org;
  const { user, orgId } = org;

  const body = await request.json().catch(() => ({}));
  const parsed = deleteFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "invalid request body" },
      { status: 400 },
    );
  }
  const { message_id } = parsed.data;

  const admin = createAdminClient();
  const load = await loadAssistantMessageInOrg(admin, message_id, orgId);
  if (!load.ok) return load.response;

  const { error: delErr } = await admin
    .from("chat_feedback")
    .delete()
    .eq("user_id", user.id)
    .eq("message_id", message_id);
  if (delErr) {
    console.error("[feedback] delete failed", delErr);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
