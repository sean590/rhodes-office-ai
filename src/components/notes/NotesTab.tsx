"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type NoteLink = { type: string; id: string; name: string | null };
type Note = {
  id: string;
  body: string;
  note_date: string;
  created_at: string;
  links: NoteLink[];
};

export type NoteTargetType = "entity" | "investment" | "contact" | "document";
type Person = { id: string; name: string; type: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
// The first line reads as a title (chat-written notes lead with a headline);
// the rest is the detail shown when expanded.
function splitTitle(body: string): { title: string; rest: string } {
  const nl = body.indexOf("\n");
  if (nl === -1) return { title: body, rest: "" };
  return { title: body.slice(0, nl).trim(), rest: body.slice(nl + 1).trim() };
}

const LINK_LABEL: Record<string, string> = {
  entity: "Entity",
  investment: "Investment",
  contact: "Person",
  document: "Document",
};

/**
 * Dated-notes panel for a record detail page. Collapsed rows show the title +
 * the records a note is associated with (by name) + its date; expanding shows
 * the full note. Notes can be tagged with people (who you spoke with) at
 * creation. Attaching to arbitrary additional records stays on the chat/API
 * path for now.
 */
export function NotesTab({ target }: { target: { type: NoteTargetType; id: string } }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [body, setBody] = useState("");
  const [noteDate, setNoteDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // People picker (who you spoke with).
  const [peopleQuery, setPeopleQuery] = useState("");
  const [peopleResults, setPeopleResults] = useState<Person[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<Person[]>([]);
  const searchAbort = useRef<AbortController | null>(null);

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

  // People search as you type.
  useEffect(() => {
    if (!peopleQuery.trim()) {
      setPeopleResults([]);
      return;
    }
    searchAbort.current?.abort();
    const ac = new AbortController();
    searchAbort.current = ac;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/notes/people?q=${encodeURIComponent(peopleQuery)}`, { signal: ac.signal });
        if (res.ok) setPeopleResults(await res.json());
      } catch {
        /* aborted / transient */
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [peopleQuery]);

  const addPerson = (p: Person) => {
    setSelectedPeople((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p]));
    setPeopleQuery("");
    setPeopleResults([]);
  };
  const removePerson = (id: string) => setSelectedPeople((prev) => prev.filter((p) => p.id !== id));

  const addNote = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const links = [
        { type: target.type, id: target.id },
        ...selectedPeople.map((p) => ({ type: "contact" as const, id: p.id })),
      ];
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim(), note_date: noteDate || undefined, links }),
      });
      if (res.ok) {
        setBody("");
        setNoteDate(today());
        setSelectedPeople([]);
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

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid var(--line)",
    background: "#fff",
    boxSizing: "border-box",
  };
  const chip = (text: string, sub?: string, onRemove?: () => void): React.ReactNode => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: "rgba(45,90,61,0.07)", border: "1px solid rgba(45,90,61,0.14)", fontSize: 11.5, color: "var(--green)", fontWeight: 500 }}>
      {sub && <span style={{ color: "var(--faint)", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>{sub}</span>}
      {text}
      {onRemove && (
        <button onClick={onRemove} aria-label="Remove" style={{ background: "none", border: "none", color: "var(--green)", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
      )}
    </span>
  );

  return (
    <div>
      {/* Add a note */}
      <div style={{ padding: 16, background: "var(--hover)", borderRadius: 10, border: "1px solid var(--line)", marginBottom: 20 }}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note — a call, a meeting, a decision… (the first line becomes the title)"
          style={{ ...inputStyle, minHeight: 72, resize: "vertical", marginBottom: 10 }}
        />

        {/* People associated with this record (generic — same form will host
            email-chain intake later, not just call notes) */}
        <div style={{ marginBottom: 10, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>People</label>
            {selectedPeople.map((p) => (
              <span key={p.id}>{chip(p.name, undefined, () => removePerson(p.id))}</span>
            ))}
            <input
              value={peopleQuery}
              onChange={(e) => setPeopleQuery(e.target.value)}
              placeholder="Add people associated with this…"
              style={{ ...inputStyle, width: "auto", flex: 1, minWidth: 160, padding: "6px 10px", fontSize: 13 }}
            />
          </div>
          {peopleResults.length > 0 && (
            <div style={{ position: "absolute", zIndex: 10, marginTop: 4, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", maxHeight: 220, overflowY: "auto", minWidth: 220 }}>
              {peopleResults.map((p) => (
                <button key={p.id} onClick={() => addPerson(p)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", borderBottom: "1px solid var(--line)", cursor: "pointer", fontSize: 13, color: "var(--ink)" }}>
                  {p.name} <span style={{ color: "var(--faint)", fontSize: 11 }}>{p.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 8 }}>Date</label>
            <input type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} style={{ ...inputStyle, width: "auto", display: "inline-block" }} />
          </div>
          <div style={{ flex: 1 }} />
          <Button variant="primary" onClick={addNote} disabled={saving || !body.trim()}>
            {saving ? "Saving…" : "Add note"}
          </Button>
        </div>
      </div>

      {/* Timeline (collapsed → expanded) */}
      {loading ? (
        <div style={{ color: "var(--faint)", fontSize: 13 }}>Loading notes…</div>
      ) : notes.length === 0 ? (
        <div style={{ color: "var(--faint)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
          No notes yet. Add the first one above — or ask Rhodes in chat to &ldquo;add a note&rdquo;.
        </div>
      ) : (
        <div>
          {notes.map((n) => {
            const { title, rest } = splitTitle(n.body);
            const isOpen = expanded.has(n.id);
            const hasMore = rest.length > 0;
            return (
              <div key={n.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <button
                    onClick={() => hasMore && toggle(n.id)}
                    aria-label={isOpen ? "Collapse" : "Expand"}
                    style={{ background: "none", border: "none", cursor: hasMore ? "pointer" : "default", color: "var(--faint)", fontSize: 12, padding: "2px 2px 0", flexShrink: 0, width: 14, visibility: hasMore ? "visible" : "hidden" }}
                  >
                    {isOpen ? "▾" : "▸"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                      <button onClick={() => hasMore && toggle(n.id)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: hasMore ? "pointer" : "default", fontSize: 14, fontWeight: 600, color: "var(--ink)", lineHeight: 1.4 }}>
                        {title}
                      </button>
                      <span style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap", flexShrink: 0 }}>{fmtDate(n.note_date)}</span>
                    </div>

                    {/* Associations (by name) */}
                    {n.links.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {n.links.map((l, i) => (
                          <span key={`${l.type}:${l.id}:${i}`}>{chip(l.name ?? "Unknown", LINK_LABEL[l.type] ?? l.type)}</span>
                        ))}
                      </div>
                    )}

                    {/* Full body when expanded */}
                    {isOpen && hasMore && (
                      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 8, whiteSpace: "pre-wrap" }}>{rest}</div>
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
