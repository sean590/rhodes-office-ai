import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import { updateNote, deleteNote, parseTargets } from "@/lib/notes";

export const maxDuration = 30;

// PATCH /api/notes/[id] — edit body/date and/or replace the association set.
// { body?, note_date?, links?: [{type,id}] }  (links replaces the whole set)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;
    const { id } = await params;
    const payload = await request.json().catch(() => ({}));
    const db = await createClient();

    const { ok, error } = await updateNote(db, orgId, user.id, id, {
      body: typeof payload?.body === "string" ? payload.body : undefined,
      noteDate: typeof payload?.note_date === "string" ? payload.note_date : undefined,
      replaceTargets: payload?.links !== undefined ? parseTargets(payload.links) : undefined,
    });
    if (!ok) return NextResponse.json({ error }, { status: error === "Note not found" ? 404 : 400 });
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
    const { orgId } = ctx;
    const { id } = await params;
    const db = await createClient();
    const { ok, error } = await deleteNote(db, orgId, id);
    if (!ok) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("DELETE /api/notes/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete note" }, { status: 500 });
  }
}
