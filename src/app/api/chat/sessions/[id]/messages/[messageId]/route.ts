/**
 * PATCH /api/chat/sessions/[sessionId]/messages/[messageId]
 *
 * Shallow-merges `metadata_merge` into the message's existing metadata JSONB.
 * Used by the approval card to persist applied_statuses so they survive
 * navigation.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, isError } from "@/lib/utils/org-context";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  const org = await requireOrg();
  if (isError(org)) return org;
  const { orgId } = org;

  const { id: sessionId, messageId } = await params;
  const admin = createAdminClient();

  // Verify session belongs to this org.
  const { data: session } = await admin
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify message belongs to this session.
  const { data: msg } = await admin
    .from("chat_messages")
    .select("id, metadata")
    .eq("id", messageId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!msg) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const merge = body.metadata_merge as Record<string, unknown> | undefined;
  if (!merge || typeof merge !== "object") {
    return NextResponse.json({ error: "metadata_merge is required" }, { status: 400 });
  }

  const existing = (msg.metadata ?? {}) as Record<string, unknown>;
  const merged = { ...existing, ...merge };

  // `applied_statuses` is a per-action map; deep-merge it so a caller can persist
  // a single action's status (Home approve/dismiss) without clobbering the
  // statuses of sibling actions on the same message. Other keys stay shallow.
  if (
    existing.applied_statuses && typeof existing.applied_statuses === "object" &&
    merge.applied_statuses && typeof merge.applied_statuses === "object"
  ) {
    merged.applied_statuses = {
      ...(existing.applied_statuses as Record<string, unknown>),
      ...(merge.applied_statuses as Record<string, unknown>),
    };
  }

  const { error } = await admin
    .from("chat_messages")
    .update({ metadata: merged })
    .eq("id", messageId);
  if (error) {
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
