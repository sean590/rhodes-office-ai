import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { parseTargets, linkRow } from "@/lib/notes";

export const maxDuration = 30;

// PATCH /api/notes/[id] — edit body/date and/or replace the set of links.
// { body?, note_date?, links?: [{type,id}] }  (links replaces the whole set)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;
    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const db = await createClient();

    // RLS scopes this to the caller's org; a foreign id simply updates nothing.
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof payload?.body === "string") {
      if (!payload.body.trim()) return NextResponse.json({ error: "Note body cannot be empty" }, { status: 400 });
      patch.body = payload.body.trim();
    }
    if (typeof payload?.note_date === "string") patch.note_date = payload.note_date;

    const { data: updated, error } = await db
      .from("notes")
      .update(patch)
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    // Replace links if provided: clear then re-insert the validated set.
    if (payload?.links !== undefined) {
      const targets = parseTargets(payload.links);
      await db.from("note_links").delete().eq("note_id", id);
      if (targets.length > 0) {
        const { error: linkErr } = await db
          .from("note_links")
          .insert(targets.map((t) => linkRow(id, orgId, t)));
        if (linkErr) throw linkErr;
      }
    }
    return NextResponse.json({ updated: true });
  } catch (err) {
    console.error("PATCH /api/notes/[id] error:", err);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

// DELETE /api/notes/[id] — remove the note (note_links cascade).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { id } = await params;
    const db = await createClient();
    const { error } = await db.from("notes").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/notes/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
