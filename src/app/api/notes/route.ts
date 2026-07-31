import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, isError } from "@/lib/utils/org-context";
import {
  createNote,
  parseTargets,
  isNoteTargetType,
  NOTE_TARGETS,
  type NoteTarget,
  type NoteTargetType,
} from "@/lib/notes";

// Notes run inline (small writes; the caller needs the created note back).
export const maxDuration = 30;

// Shape a note_links row into a typed {type, id}.
function shapeLinks(rows: Array<Record<string, string | null>>): NoteTarget[] {
  const out: NoteTarget[] = [];
  for (const r of rows) {
    if (r.entity_id) out.push({ type: "entity", id: r.entity_id });
    else if (r.investment_id) out.push({ type: "investment", id: r.investment_id });
    else if (r.directory_entry_id) out.push({ type: "contact", id: r.directory_entry_id });
    else if (r.document_id) out.push({ type: "document", id: r.document_id });
  }
  return out;
}

// POST /api/notes — create a note attached to zero or more records.
// { body, note_date?, links: [{ type, id }] }
export async function POST(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId, user } = ctx;

    const payload = await request.json().catch(() => ({}));
    const db = await createClient();
    const { note, error } = await createNote(db, orgId, user.id, {
      body: payload?.body,
      noteDate: payload?.note_date,
      targets: parseTargets(payload?.links),
    });
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json(note, { status: 201 });
  } catch (err) {
    console.error("POST /api/notes error:", err);
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }
}

// GET /api/notes?type=investment&id=<uuid> — the timeline of notes for one
// record, newest first, each with its full set of links.
export async function GET(request: Request) {
  try {
    const ctx = await requireOrg();
    if (isError(ctx)) return ctx;
    const { orgId } = ctx;

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id");
    if (!type || !id || !isNoteTargetType(type)) {
      return NextResponse.json({ error: "type and id query params are required" }, { status: 400 });
    }
    const column = NOTE_TARGETS[type as NoteTargetType];

    const db = await createClient();
    const { data: links, error: linkErr } = await db
      .from("note_links")
      .select("note_id")
      .eq("organization_id", orgId)
      .eq(column, id);
    if (linkErr) throw linkErr;
    const noteIds = Array.from(new Set((links ?? []).map((l) => l.note_id as string)));
    if (noteIds.length === 0) return NextResponse.json([]);

    const { data: notes, error } = await db
      .from("notes")
      .select("id, body, note_date, created_by, created_at, updated_at, note_links(*)")
      .in("id", noteIds)
      .order("note_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;

    const shaped = (notes ?? []).map((n) => {
      const { note_links, ...rest } = n as Record<string, unknown> & {
        note_links?: Array<Record<string, string | null>>;
      };
      return { ...rest, links: shapeLinks(note_links ?? []) };
    });
    return NextResponse.json(shaped);
  } catch (err) {
    console.error("GET /api/notes error:", err);
    return NextResponse.json({ error: "Failed to load notes" }, { status: 500 });
  }
}
