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
  await auditNote(userId, orgId, note.id as string, body, owned, "create_note");
  return { note: { ...(note as Omit<NoteRecord, "links">), links: owned } };
}

/**
 * Emit one audit row per associated entity AND per associated investment, so
 * the note appears in EVERY linked record's activity feed (which filters
 * audit_log by entity_id / investment_id). A note with no entity/investment
 * link still records one org-level row.
 */
async function auditNote(
  userId: string | null,
  orgId: string,
  noteId: string,
  body: string,
  targets: NoteTarget[],
  action: "create_note" | "update_note",
): Promise<void> {
  const title = body.split("\n")[0].slice(0, 140);
  const anchors = targets.filter((t) => t.type === "entity" || t.type === "investment");
  const rows: Array<NoteTarget | null> = anchors.length ? anchors : [null];
  for (const t of rows) {
    await logAuditEvent({
      userId,
      action,
      resourceType: "note",
      resourceId: noteId,
      entityId: t?.type === "entity" ? t.id : null,
      investmentId: t?.type === "investment" ? t.id : null,
      organizationId: orgId,
      metadata: { note_id: noteId, title, links: targets.length },
    }).catch(() => {});
  }
}

/**
 * Update a note: edit body/date and change associations. Two link modes:
 *  - replaceTargets: set the exact association set (the UI edit form).
 *  - addTargets / removeTargets: additive/subtractive (natural for chat:
 *    "attach Brent Hudson to that note").
 * Org-scoped explicitly (safe on the admin apply path). Emits an audit row per
 * associated entity/investment so the edit shows in each record's activity.
 */
export async function updateNote(
  db: SupabaseClient,
  orgId: string,
  userId: string | null,
  noteId: string,
  input: {
    body?: string;
    noteDate?: string;
    addTargets?: NoteTarget[];
    removeTargets?: NoteTarget[];
    replaceTargets?: NoteTarget[];
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing } = await db
    .from("notes")
    .select("id")
    .eq("id", noteId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Note not found" };

  const patch: Record<string, unknown> = {};
  if (typeof input.body === "string") {
    if (!input.body.trim()) return { ok: false, error: "Note body cannot be empty" };
    patch.body = input.body.trim();
  }
  if (typeof input.noteDate === "string") patch.note_date = input.noteDate;
  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error } = await db.from("notes").update(patch).eq("id", noteId).eq("organization_id", orgId);
    if (error) return { ok: false, error: error.message };
  }

  if (input.replaceTargets) {
    // Full replace: clear then insert the validated set.
    await db.from("note_links").delete().eq("note_id", noteId).eq("organization_id", orgId);
    const owned = await filterOwnedTargets(db, orgId, input.replaceTargets);
    if (owned.length > 0) {
      const { error } = await db.from("note_links").insert(owned.map((t) => linkRow(noteId, orgId, t)));
      if (error) return { ok: false, error: error.message };
    }
  } else {
    if (input.addTargets?.length) {
      const owned = await filterOwnedTargets(db, orgId, input.addTargets);
      // Dedup against links the note already has (the junction's unique index
      // treats NULLs as distinct, so it won't catch duplicate contact links).
      const { data: current } = await db
        .from("note_links")
        .select("entity_id, investment_id, directory_entry_id, document_id")
        .eq("note_id", noteId);
      const have = new Set<string>();
      for (const r of (current ?? []) as Array<Record<string, string | null>>) {
        if (r.entity_id) have.add(`entity:${r.entity_id}`);
        else if (r.investment_id) have.add(`investment:${r.investment_id}`);
        else if (r.directory_entry_id) have.add(`contact:${r.directory_entry_id}`);
        else if (r.document_id) have.add(`document:${r.document_id}`);
      }
      const toAdd = owned.filter((t) => !have.has(`${t.type}:${t.id}`));
      if (toAdd.length > 0) {
        const { error } = await db.from("note_links").insert(toAdd.map((t) => linkRow(noteId, orgId, t)));
        if (error) return { ok: false, error: error.message };
      }
    }
    if (input.removeTargets?.length) {
      for (const t of input.removeTargets) {
        await db
          .from("note_links")
          .delete()
          .eq("note_id", noteId)
          .eq("organization_id", orgId)
          .eq(NOTE_TARGETS[t.type], t.id);
      }
    }
  }

  // Audit the edit against the note's CURRENT anchors.
  const { data: n } = await db.from("notes").select("body").eq("id", noteId).maybeSingle();
  const { data: links } = await db
    .from("note_links")
    .select("entity_id, investment_id")
    .eq("note_id", noteId);
  const anchors: NoteTarget[] = [];
  for (const r of (links ?? []) as Array<Record<string, string | null>>) {
    if (r.entity_id) anchors.push({ type: "entity", id: r.entity_id });
    else if (r.investment_id) anchors.push({ type: "investment", id: r.investment_id });
  }
  await auditNote(userId, orgId, noteId, (n?.body as string) ?? "", anchors, "update_note");
  return { ok: true };
}

/** Delete a note (note_links cascade). Org-scoped. */
export async function deleteNote(
  db: SupabaseClient,
  orgId: string,
  noteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from("notes").delete().eq("id", noteId).eq("organization_id", orgId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
