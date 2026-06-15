"use client";

/**
 * DirectoryEntryForm — create/edit a Directory person/company/trust. Extracted
 * from the old /directory page so the People registry (Phase 6b) owns this CRUD.
 * POST /api/directory (create) · PUT /api/directory/[id] (edit). Delete + the
 * referenced-entry "replace" flow stay in the parent (it needs the full list).
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

export type DirectoryEntryType = "individual" | "external_entity" | "trust";

export interface DirectoryEntry {
  id: string;
  name: string;
  type: DirectoryEntryType;
  email: string | null;
  aliases: string[];
}

export const DIRECTORY_TYPE_OPTIONS: { value: DirectoryEntryType; label: string }[] = [
  { value: "individual", label: "Person" },
  { value: "external_entity", label: "Company" },
  { value: "trust", label: "Trust" },
];

const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", fontSize: 13.5, fontFamily: "inherit",
  padding: "8px 10px", border: "1px solid var(--line-2)", borderRadius: "var(--radius-sm)",
  background: "var(--card)", color: "var(--ink)", outline: "none",
};
const label: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 5 };

export function DirectoryEntryForm({ entry, onSaved, onCancel }: {
  entry: DirectoryEntry | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(entry?.name ?? "");
  const [type, setType] = useState<DirectoryEntryType>(entry?.type ?? "individual");
  const [email, setEmail] = useState(entry?.email ?? "");
  const [aliases, setAliases] = useState<string[]>(entry?.aliases ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(entry ? `/api/directory/${entry.id}` : "/api/directory", {
        method: entry ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          email: email.trim() || null,
          aliases: aliases.map((a) => a.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Couldn't save."); return; }
      onSaved();
    } catch { setError("Couldn't save."); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 12 }}>
        <div>
          <label style={label}>Name</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name or company name" autoFocus />
        </div>
        <div>
          <label style={label}>Type</label>
          <select style={input} value={type} onChange={(e) => setType(e.target.value as DirectoryEntryType)}>
            {DIRECTORY_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ maxWidth: 420 }}>
        <label style={label}>Email</label>
        <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
      </div>

      <div>
        <label style={label}>Also known as</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {aliases.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 6 }}>
              <input style={{ ...input, maxWidth: 420 }} value={a} onChange={(e) => setAliases((p) => p.map((x, idx) => idx === i ? e.target.value : x))} placeholder="Alias or alternate name" />
              <button onClick={() => setAliases((p) => p.filter((_, idx) => idx !== i))} style={{ background: "none", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", cursor: "pointer", padding: "0 10px", color: "var(--muted)", display: "grid", placeItems: "center" }}>
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
          <button onClick={() => setAliases((p) => [...p, ""])} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: "var(--green)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "2px 0" }}>
            <Icon name="plus" size={13} /> Add alias
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>{saving ? "Saving…" : entry ? "Save changes" : "Add person"}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
