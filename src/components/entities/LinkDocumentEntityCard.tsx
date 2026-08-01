"use client";

import { useState, useEffect, useCallback } from "react";

interface EntityLink {
  entity_id: string;
  entity_name: string;
  role: string;
  is_primary: boolean;
}

interface Props {
  documentId: string;
  documentName: string;
  onChanged?: () => void;
  onClose: () => void;
}

/**
 * Inline editor for a document's entity associations. A document has one
 * primary/home entity plus any number of additional links (document_entity_links
 * junction); this surfaces all of them and lets the user add/remove the
 * additional ones. Mirrors SendToProviderCard's inline-card pattern.
 */
export function LinkDocumentEntityCard({ documentId, documentName, onChanged, onClose }: Props) {
  const [links, setLinks] = useState<EntityLink[]>([]);
  const [allEntities, setAllEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState("");

  const loadLinks = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}/entity-links`);
      setLinks(res.ok ? await res.json() : []);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAllEntities((data || []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))))
      .catch(() => {});
  }, []);

  const linkedIds = new Set(links.map((l) => l.entity_id));

  const add = async () => {
    if (!picker) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/entity-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: picker }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error || "Failed to link");
        return;
      }
      setPicker("");
      await loadLinks();
      onChanged?.();
    } catch {
      setError("Failed to link");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entityId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/entity-links`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: entityId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error || "Failed to remove");
        return;
      }
      await loadLinks();
      onChanged?.();
    } catch {
      setError("Failed to remove");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 12, background: "#fff", border: "1px solid #e8e6df", borderRadius: 8, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#4a4a52" }}>Entities linked to “{documentName}”</div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 16, lineHeight: 1, padding: 0 }}>✕</button>
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: "#9494a0" }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {links.map((l) => (
            <div key={l.entity_id} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", background: l.is_primary ? "rgba(45,90,61,0.08)" : "#f0eee8",
              borderRadius: 6, fontSize: 12, color: "#1a1a1f",
            }}>
              <span>{l.entity_name}</span>
              {l.is_primary ? (
                <span style={{ fontSize: 10, fontWeight: 600, color: "#2d5a3d", textTransform: "uppercase", letterSpacing: "0.04em" }}>Home</span>
              ) : (
                <button
                  onClick={() => remove(l.entity_id)}
                  disabled={busy}
                  title="Remove association"
                  style={{ background: "none", border: "none", cursor: busy ? "default" : "pointer", color: "#9494a0", fontSize: 13, padding: 0, lineHeight: 1 }}
                >✕</button>
              )}
            </div>
          ))}
          {links.length === 0 && <div style={{ fontSize: 12, color: "#9494a0" }}>No entities linked.</div>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={picker}
          onChange={(e) => setPicker(e.target.value)}
          style={{ flex: 1, padding: "7px 10px", fontSize: 12, border: "1px solid #ddd9d0", borderRadius: 6, background: "#fff", color: "#1a1a1f" }}
        >
          <option value="">Link another entity…</option>
          {allEntities.filter((e) => !linkedIds.has(e.id)).map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={!picker || busy}
          style={{
            padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none",
            background: picker && !busy ? "#2d5a3d" : "#ddd9d0",
            color: picker && !busy ? "#fff" : "#9494a0",
            cursor: picker && !busy ? "pointer" : "not-allowed",
          }}
        >Link</button>
      </div>
      <div style={{ fontSize: 11, color: "#9494a0", marginTop: 8 }}>
        The document stays filed under its home entity and also appears on each linked entity.
      </div>
      {error && <div style={{ fontSize: 12, color: "#c73e3e", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
