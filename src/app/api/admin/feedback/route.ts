/**
 * GET /api/admin/feedback — owner-only feedback query for the admin view.
 *
 * Lists chat_feedback rows for the caller's org, joined with:
 *   - user_profiles (display_name) + users (email) for "who left this"
 *   - chat_messages (content, session_id) for the preview column
 *
 * Query params:
 *   - rating=up|down — filter by rating
 *   - page=N — 1-indexed page number (50 rows per page)
 *
 * Response: { rows: [...], page, total, pageSize }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrgRole } from "@/lib/utils/auth";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const user = await requireOrgRole("owner").catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgId = user.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const url = new URL(request.url);
  const ratingParam = url.searchParams.get("rating");
  const pageParam = parseInt(url.searchParams.get("page") || "1", 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const rating = ratingParam === "up" || ratingParam === "down" ? ratingParam : null;

  const admin = createAdminClient();
  const offset = (page - 1) * PAGE_SIZE;

  let query = admin
    .from("chat_feedback")
    .select("id, user_id, message_id, rating, comment, created_at", { count: "exact" })
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (rating) query = query.eq("rating", rating);

  const { data: rows, error, count } = await query;
  if (error) {
    console.error("[admin/feedback] list failed", error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
  const feedbackRows = (rows ?? []) as Array<{
    id: string;
    user_id: string;
    message_id: string;
    rating: string;
    comment: string | null;
    created_at: string;
  }>;

  // Enrich with message content + user display info via batched lookups.
  const userIds = Array.from(new Set(feedbackRows.map((r) => r.user_id)));
  const messageIds = Array.from(new Set(feedbackRows.map((r) => r.message_id)));

  const [profilesRes, usersRes, messagesRes] = await Promise.all([
    userIds.length > 0
      ? admin.from("user_profiles").select("id, display_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length > 0
      ? admin.from("users").select("external_id, email").in("external_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    messageIds.length > 0
      ? admin
          .from("chat_messages")
          .select("id, session_id, content")
          .in("id", messageIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const profileMap = new Map(
    ((profilesRes.data as Array<{ id: string; display_name: string | null }>) ?? []).map(
      (p) => [p.id, p.display_name],
    ),
  );
  const emailMap = new Map(
    ((usersRes.data as Array<{ external_id: string; email: string }>) ?? []).map(
      (u) => [u.external_id, u.email],
    ),
  );
  const messageMap = new Map(
    ((messagesRes.data as Array<{ id: string; session_id: string; content: string }>) ?? []).map(
      (m) => [m.id, m],
    ),
  );

  const enriched = feedbackRows.map((r) => {
    const msg = messageMap.get(r.message_id);
    const fullContent = msg?.content ?? "";
    return {
      id: r.id,
      created_at: r.created_at,
      rating: r.rating,
      comment: r.comment,
      message_id: r.message_id,
      session_id: msg?.session_id ?? null,
      message_preview: fullContent.length > 200 ? fullContent.slice(0, 200) + "…" : fullContent,
      user_id: r.user_id,
      display_name: profileMap.get(r.user_id) ?? null,
      email: emailMap.get(r.user_id) ?? null,
    };
  });

  return NextResponse.json({
    rows: enriched,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}
