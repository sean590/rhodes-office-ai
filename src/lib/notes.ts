/**
 * Dated notes (rhodes-future-enhancements.md §7). A note memorializes non-
 * document context (a call, a decision) and can attach to MANY records of
 * different kinds at once — an entity AND an investment AND a contact — via the
 * note_links junction. All access is via the user's RLS-scoped client, so org
 * isolation is enforced by the database, not this code.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/utils/audit";

/** The record kinds a note can attach to → the note_links FK column. */
export const NOTE_TARGETS = {
  entity: "entity_id",
  investment: "investment_id",
  contact: "directory_entry_id", // "external contact" = a directory entry
  document: "document_id",
} as const;

export type NoteTargetType = keyof typeof NOTE_TARGETS;
export type NoteTarget = { type: NoteTargetType; id: string };

/** The table each target type lives in — used to verify the target is in the
 *  caller's org before linking (RLS makes a cross-org id return nothing). */
const TARGET_TABLE: Record<NoteTargetType, string> = {
  entity: "entities",
  investment: "investments",
  contact: "directory_entries",
  document: "documents",
};

export function isNoteTargetType(v: string): v is NoteTargetType {
  return v in NOTE_TARGETS;
}

/** Normalize/validate a raw links payload into typed targets (dedupes). */
export function parseTargets(raw: unknown): NoteTarget[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NoteTarget[] = [];
  for (const item of raw) {
    const type = (item as { type?: string })?.type;
    const id = (item as { id?: string })?.id;
    if (typeof type !== "string" || typeof id !== "string" || !isNoteTargetType(type)) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id });
  }
  return out;
}

/** Build a note_links insert row for one target (exactly one FK set). */
export function linkRow(noteId: string, orgId: string, t: NoteTarget): Record<string, string> {
  return { note_id: noteId, organization_id: orgId, [NOTE_TARGETS[t.type]]: t.id };
}

export type NoteRecord = {
  id: string;
  body: string;
  note_date: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  links: NoteTarget[];
};

/** Keep only targets that exist IN THIS ORG. Filters by organization_id
 *  explicitly (not just RLS) so it's correct on the admin-client apply path
 *  too — prevents linking a note to another org's record by guessing an id. */
async function filterOwnedTargets(
  db: SupabaseClient,
  orgId: string,
  targets: NoteTarget[],
): Promise<NoteTarget[]> {
  const owned: NoteTarget[] = [];
  for (const type of new Set(targets.map((t) => t.type))) {
    const ids = targets.filter((t) => t.type === type).map((t) => t.id);
    const { data } = await db
      .from(TARGET_TABLE[type])
      .select("id")
      .eq("organization_id", orgId)
      .in("id", ids);
    const found = new Set((data ?? []).map((r) => r.id as string));
    for (const id of ids) if (found.has(id)) owned.push({ type, id });
  }
  return owned;
}

/** Create a note and link it to the given targets (validated for org ownership). */
export async function createNote(
  db: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: { body: string; noteDate?: string; targets: NoteTarget[] },
): Promise<{ note: NoteRecord | null; error?: string }> {
  const body = input.body?.trim();
  if (!body) return { note: null, error: "Note body is required" };

  const { data: note, error } = await db
    .from("notes")
    .insert({
      organization_id: orgId,
      body,
      note_date: input.noteDate || undefined,
      created_by: userId,
    })
    .select("id, body, note_date, created_by, created_at, updated_at")
    .single();
  if (error || !note) return { note: null, error: error?.message || "Failed to create note" };

  const owned = await filterOwnedTargets(db, orgId, input.targets);
  if (owned.length > 0) {
    const { error: linkErr } = await db
      .from("note_links")
      .insert(owned.map((t) => linkRow(note.id as string, orgId, t)));
    if (linkErr) {
      // Roll back the orphaned note so a partial write doesn't linger.
      await db.from("notes").delete().eq("id", note.id);
      return { note: null, error: `Failed to link note: ${linkErr.message}` };
    }
  }
  // Audit so the note surfaces in the linked entity's / investment's activity
  // feed (which filters audit_log by entity_id / investment_id). A note on
  // several records of one kind attributes to the first — the Notes tab shows
  // the full association set.
  await logAuditEvent({
    userId,
    action: "create_note",
    resourceType: "note",
    resourceId: note.id as string,
    entityId: owned.find((t) => t.type === "entity")?.id ?? null,
    investmentId: owned.find((t) => t.type === "investment")?.id ?? null,
    organizationId: orgId,
    metadata: { note_id: note.id, title: body.split("\n")[0].slice(0, 140), links: owned.length },
  }).catch(() => {});

  return { note: { ...(note as Omit<NoteRecord, "links">), links: owned } };
}
