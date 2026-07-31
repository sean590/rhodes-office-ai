"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// A note as returned by GET /api/notes.
type Note = {
  id: string;
  body: string;
  note_date: string;
  created_at: string;
  links: Array<{ type: string; id: string }>;
};

export type NoteTargetType = "entity" | "investment" | "contact" | "document";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d: string): string {
  // note_date is a bare YYYY-MM-DD — anchor to noon to avoid TZ slippage.
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Dated-notes panel for a record detail page. Lists the note timeline (newest
 * first) and adds a note linked to THIS record. Cross-linking a note to several
 * records at once is available via chat / the API; a multi-record picker here
 * is a follow-up.
 */
export function NotesTab({
  target,
}: {
  target: { type: NoteTargetType; id: string };
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [noteDate, setNoteDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/notes?type=${target.type}&id=${target.id}`);
      if (res.ok) setNotes(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [target.type, target.id]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const addNote = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          note_date: noteDate || undefined,
          links: [{ type: target.type, id: target.id }],
        }),
      });
      if (res.ok) {
        setBody("");
        setNoteDate(today());
        await fetchNotes();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Couldn't save the note.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (res.ok) await fetchNotes();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingId(null);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "#fff",
    boxSizing: "border-box",
  };

  return (
    <div>
      {/* Add a note */}
      <div style={{ padding: 16, background: "var(--hover)", borderRadius: 10, border: "1px solid var(--line)", marginBottom: 20 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note — a call, a meeting, a decision…"
          style={{ ...inputStyle, minHeight: 72, resize: "vertical", marginBottom: 10 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 8 }}>
              Date
            </label>
            <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} style={{ ...inputStyle, width: "auto", display: "inline-block" }} />
          </div>
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={addNote} disabled={saving || !body.trim()}>
            {saving ? "Saving…" : "Add note"}
          </Button>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div style={{ color: "var(--faint)", fontSize: 13 }}>Loading notes…</div>
      ) : notes.length === 0 ? (
        <div style={{ color: "var(--faint)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
          No notes yet. Add the first one above — or ask Rhodes in chat to &ldquo;add a note&rdquo;.
        </div>
      ) : (
        <div>
          {notes.map((n) => {
            const otherLinks = n.links.filter((l) => !(l.type === target.type && l.id === target.id)).length;
            return (
              <div key={n.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--green)" }}>{fmtDate(n.note_date)}</div>
                    <div style={{ fontSize: 13.5, color: "var(--ink)", lineHeight: 1.55, marginTop: 4, whiteSpace: "pre-wrap" }}>{n.body}</div>
                    {otherLinks > 0 && (
                      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 4 }}>
                        Also linked to {otherLinks} other record{otherLinks === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => deleteNote(n.id)}
                    disabled={deletingId === n.id}
                    title="Delete note"
                    aria-label="Delete note"
                    style={{ background: "none", border: "none", color: "var(--faint)", fontSize: 15, lineHeight: 1, cursor: deletingId === n.id ? "default" : "pointer", padding: "2px 6px", flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
