"use client";

import React, { useState, useEffect, useCallback } from "react";
import { SearchInput } from "@/components/ui/search-input";
import { FilterPills } from "@/components/ui/filter-pills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { PlusIcon, XIcon, BuildingIcon, AlertIcon } from "@/components/ui/icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DirectoryEntryType = "individual" | "external_entity" | "trust";

interface DirectoryEntryResponse {
  id: string;
  name: string;
  type: DirectoryEntryType;
  email: string | null;
  aliases: string[];
  usage_count: number;
  usage_details: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<DirectoryEntryType, string> = {
  individual: "Individual",
  external_entity: "External Entity",
  trust: "Trust",
};

const TYPE_BADGE_STYLES: Record<DirectoryEntryType, { bg: string; color: string }> = {
  individual: { bg: "rgba(45,90,61,0.10)", color: "#2d5a3d" },
  external_entity: { bg: "rgba(51,102,168,0.10)", color: "#3366a8" },
  trust: { bg: "rgba(196,117,32,0.10)", color: "#c47520" },
};

const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "individual", label: "Individual" },
  { value: "external_entity", label: "External Entity" },
  { value: "trust", label: "Trust" },
];

const EMPTY_FORM = { name: "", type: "individual" as DirectoryEntryType, email: "", aliases: [] as string[] };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DirectoryPage() {
  // Data
  const [entries, setEntries] = useState<DirectoryEntryResponse[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  // Expanded + editing
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  // Internal entity count (entities that live in the entities table)
  const [internalCount, setInternalCount] = useState(0);

  // Replacement modal
  const [replaceModal, setReplaceModal] = useState<{
    entryId: string;
    entryName: string;
    usageCount: number;
  } | null>(null);
  const [replacementId, setReplacementId] = useState<string>("");
  const [replaceSaving, setReplaceSaving] = useState(false);

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/directory");
      if (!res.ok) throw new Error("Failed to fetch directory");
      const data: DirectoryEntryResponse[] = await res.json();
      setEntries(data);

      // Derive internal entity count from entities endpoint
      try {
        const entRes = await fetch("/api/entities");
        if (entRes.ok) {
          const entData = await entRes.json();
          setInternalCount(Array.isArray(entData) ? entData.length : 0);
        }
      } catch {
        // Silently ignore — internal count is supplementary
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  const handleAdd = async () => {
    if (!addForm.name.trim()) return;
    setAddSaving(true);
    try {
      const res = await fetch("/api/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name.trim(),
          type: addForm.type,
          email: addForm.email.trim() || null,
          aliases: addForm.aliases.filter((a) => a.trim()),
        }),
      });
      if (!res.ok) throw new Error("Failed to create entry");
      setShowAdd(false);
      setAddForm(EMPTY_FORM);
      await fetchEntries();
    } catch (err) {
      console.error(err);
    } finally {
      setAddSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/directory/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          type: editForm.type,
          email: editForm.email.trim() || null,
          aliases: editForm.aliases.filter((a) => a.trim()),
        }),
      });
      if (!res.ok) throw new Error("Failed to update entry");
      setEditingId(null);
      setEditForm(EMPTY_FORM);
      await fetchEntries();
    } catch (err) {
      console.error(err);
    } finally {
      setEditSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      const res = await fetch(`/api/directory/${id}`, { method: "DELETE" });

      if (res.status === 409) {
        const data = await res.json();
        const entry = entries.find((e) => e.id === id);
        setReplaceModal({
          entryId: id,
          entryName: entry?.name || "this entry",
          usageCount: data.usage_count || 0,
        });
        setReplacementId("");
        return;
      }

      if (!res.ok) throw new Error("Failed to delete entry");
      setEditingId(null);
      setEditForm(EMPTY_FORM);
      await fetchEntries();
    } catch (err) {
      console.error(err);
    }
  };

  const handleReplaceAndDelete = async () => {
    if (!replaceModal || !replacementId) return;
    setReplaceSaving(true);
    try {
      const res = await fetch(`/api/directory/${replaceModal.entryId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacement_id: replacementId }),
      });
      if (!res.ok) throw new Error("Failed to replace and delete entry");
      setReplaceModal(null);
      setReplacementId("");
      setEditingId(null);
      setEditForm(EMPTY_FORM);
      await fetchEntries();
    } catch (err) {
      console.error(err);
    } finally {
      setReplaceSaving(false);
    }
  };

  const toggleExpanded = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
      setEditForm(EMPTY_FORM);
    } else {
      setExpandedId(id);
      setEditingId(null);
      setEditForm(EMPTY_FORM);
    }
  };

  const startEdit = (entry: DirectoryEntryResponse) => {
    setExpandedId(entry.id);
    setEditingId(entry.id);
    setEditForm({ name: entry.name, type: entry.type, email: entry.email ?? "", aliases: entry.aliases || [] });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const counts: Record<string, number> = {
    individual: entries.filter((e) => e.type === "individual").length,
    external_entity: entries.filter((e) => e.type === "external_entity").length,
    trust: entries.filter((e) => e.type === "trust").length,
  };

  const filtered = entries.filter((e) => {
    if (filter !== "all" && e.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.name.toLowerCase().includes(q) ||
        (e.email ?? "").toLowerCase().includes(q) ||
        TYPE_LABELS[e.type].toLowerCase().includes(q) ||
        (e.aliases || []).some((a) => a.toLowerCase().includes(q))
      );
    }
    return true;
  });

  // -----------------------------------------------------------------------
  // Shared styles
  // -----------------------------------------------------------------------

  const inputStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
  };

  const thStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#9494a0",
    padding: "10px 12px",
    textAlign: "left",
    borderBottom: "1px solid #e8e6df",
  };

  const tdStyle: React.CSSProperties = {
    padding: "14px 12px",
    borderBottom: "1px solid #f0eee8",
    fontSize: 13,
    verticalAlign: "middle",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#6b6b76",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1f" }}>Directory</div>
        <div style={{ color: "#9494a0", marginTop: 12 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ----------------------------------------------------------------- */}
      {/* Header */}
      {/* ----------------------------------------------------------------- */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1f", margin: 0 }}>Directory</h1>
          <p style={{ fontSize: 13, color: "#6b6b76", margin: "4px 0 0" }}>
            Manage people and external entities &mdash; changes apply everywhere
          </p>
        </div>
        {!showAdd && (
          <Button variant="primary" onClick={() => setShowAdd(true)}>
            <PlusIcon size={14} /> Add Entry
          </Button>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Add entry form */}
      {/* ----------------------------------------------------------------- */}
      {showAdd && (
        <Card style={{ marginBottom: 20 }}>
          <SectionHeader>Add Directory Entry</SectionHeader>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            {/* Name */}
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b6b76", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Name
              </label>
              <input
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name or entity name"
              />
            </div>

            {/* Type */}
            <div style={{ flex: "0 0 180px" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b6b76", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Type
              </label>
              <select
                style={{ ...selectStyle, width: "100%", boxSizing: "border-box" }}
                value={addForm.type}
                onChange={(e) => setAddForm((f) => ({ ...f, type: e.target.value as DirectoryEntryType }))}
              >
                <option value="individual">Individual</option>
                <option value="external_entity">External Entity</option>
                <option value="trust">Trust</option>
              </select>
            </div>

            {/* Email */}
            <div style={{ flex: "1 1 200px" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6b6b76", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Email
              </label>
              <input
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                value={addForm.email}
                onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, paddingBottom: 1 }}>
              <Button variant="primary" onClick={handleAdd} disabled={addSaving || !addForm.name.trim()}>
                {addSaving ? "Saving..." : "Save"}
              </Button>
              <Button
                onClick={() => {
                  setShowAdd(false);
                  setAddForm(EMPTY_FORM);
                }}
              >
                <XIcon size={12} /> Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Filter + search row */}
      {/* ----------------------------------------------------------------- */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <FilterPills
          options={FILTER_OPTIONS.map((o) => ({
            ...o,
            count: o.value === "all" ? entries.length : counts[o.value] ?? 0,
          }))}
          selected={filter}
          onChange={setFilter}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search directory..." />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Replacement modal */}
      {/* ----------------------------------------------------------------- */}
      {replaceModal && (
        <Card style={{ marginBottom: 20, border: "1px solid rgba(199,62,62,0.25)", background: "#fffbfa" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: "rgba(199,62,62,0.08)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              <AlertIcon size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", marginBottom: 4 }}>
                Replace &ldquo;{replaceModal.entryName}&rdquo;?
              </div>
              <div style={{ fontSize: 13, color: "#6b6b76", marginBottom: 16 }}>
                This person is referenced in{" "}
                <strong>{replaceModal.usageCount} {replaceModal.usageCount === 1 ? "place" : "places"}</strong>.
                Select someone to take over those references, or cancel.
              </div>

              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#6b6b76",
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Replace with
                </label>
                <select
                  value={replacementId}
                  onChange={(e) => setReplacementId(e.target.value)}
                  style={{
                    ...selectStyle,
                    width: "100%",
                    maxWidth: 360,
                    boxSizing: "border-box" as const,
                    padding: "8px 12px",
                  }}
                >
                  <option value="">Select a replacement...</option>
                  {entries
                    .filter((e) => e.id !== replaceModal.entryId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({TYPE_LABELS[e.type]})
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="primary"
                  onClick={handleReplaceAndDelete}
                  disabled={!replacementId || replaceSaving}
                >
                  {replaceSaving ? "Replacing..." : "Replace & Delete"}
                </Button>
                <Button onClick={() => { setReplaceModal(null); setReplacementId(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Table */}
      {/* ----------------------------------------------------------------- */}
      <div style={{ background: "#ffffff", border: "1px solid #e8e6df", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "40%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Email</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#9494a0", padding: "32px 12px" }}>
                  {search || filter !== "all"
                    ? "No entries match your filters."
                    : "No directory entries yet. Click \"Add Entry\" to get started."}
                </td>
              </tr>
            )}

            {filtered.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const isEditing = editingId === entry.id;
              const badgeStyle = TYPE_BADGE_STYLES[entry.type];
              const hasAliases = entry.aliases && entry.aliases.length > 0;

              return (
                <React.Fragment key={entry.id}>
                  {/* ---- Compact row ---- */}
                  <tr
                    onClick={() => toggleExpanded(entry.id)}
                    style={{
                      cursor: "pointer",
                      display: isExpanded ? "none" : undefined,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fafaf7")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <td style={{ ...tdStyle, fontWeight: 500 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.name}
                        </span>
                        {hasAliases && (
                          <span style={{ fontSize: 11, color: "#9494a0", flexShrink: 0 }}>
                            +{entry.aliases.length} alias{entry.aliases.length > 1 ? "es" : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <Badge label={TYPE_LABELS[entry.type]} bg={badgeStyle.bg} color={badgeStyle.color} />
                    </td>
                    <td style={{ ...tdStyle, color: "#6b6b76", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.email || <span style={{ color: "#9494a0" }}>&mdash;</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", color: "#9494a0", fontSize: 12 }}>
                      {entry.usage_count > 0 && (
                        <span style={{
                          background: "rgba(45,90,61,0.06)",
                          color: "#2d5a3d",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 500,
                        }}>
                          {entry.usage_count}
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* ---- Expanded panel ---- */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={4} style={{ borderBottom: "1px solid #f0eee8", padding: 0 }}>
                        <div style={{ background: "#faf9f6", padding: "16px 20px" }}>
                          {/* Header with name + collapse chevron */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontWeight: 600, fontSize: 15, color: "#1a1a1f" }}>{entry.name}</span>
                              <Badge label={TYPE_LABELS[entry.type]} bg={badgeStyle.bg} color={badgeStyle.color} />
                            </div>
                            <button
                              onClick={() => toggleExpanded(entry.id)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: "4px 6px",
                                color: "#9494a0",
                                display: "flex",
                                alignItems: "center",
                              }}
                              title="Collapse"
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12">
                                <path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>

                          {isEditing ? (
                            /* ---- Edit form ---- */
                            <div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                                {/* Name */}
                                <div>
                                  <label style={labelStyle}>Name</label>
                                  <input
                                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                                    value={editForm.name}
                                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                  />
                                </div>
                                {/* Type */}
                                <div>
                                  <label style={labelStyle}>Type</label>
                                  <select
                                    style={{ ...selectStyle, width: "100%", boxSizing: "border-box" }}
                                    value={editForm.type}
                                    onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as DirectoryEntryType }))}
                                  >
                                    <option value="individual">Individual</option>
                                    <option value="external_entity">External Entity</option>
                                    <option value="trust">Trust</option>
                                  </select>
                                </div>
                                {/* Email */}
                                <div>
                                  <label style={labelStyle}>Email</label>
                                  <input
                                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                                    value={editForm.email}
                                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                                    placeholder="Optional"
                                  />
                                </div>
                              </div>

                              {/* Aliases editing */}
                              <div style={{ marginBottom: 16 }}>
                                <label style={labelStyle}>Also Known As</label>
                                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                  {editForm.aliases.map((alias, idx) => (
                                    <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center", maxWidth: 400 }}>
                                      <input
                                        style={{ ...inputStyle, flex: 1, boxSizing: "border-box" }}
                                        value={alias}
                                        onChange={(e) => {
                                          const updated = [...editForm.aliases];
                                          updated[idx] = e.target.value;
                                          setEditForm((f) => ({ ...f, aliases: updated }));
                                        }}
                                        placeholder="Alternate name"
                                      />
                                      <button
                                        onClick={() => {
                                          const updated = editForm.aliases.filter((_, i) => i !== idx);
                                          setEditForm((f) => ({ ...f, aliases: updated }));
                                        }}
                                        style={{
                                          background: "none",
                                          border: "none",
                                          cursor: "pointer",
                                          color: "#c73e3e",
                                          padding: "4px",
                                          fontSize: 14,
                                          lineHeight: 1,
                                        }}
                                        title="Remove alias"
                                      >
                                        <XIcon size={10} />
                                      </button>
                                    </div>
                                  ))}
                                  <button
                                    onClick={() => setEditForm((f) => ({ ...f, aliases: [...f.aliases, ""] }))}
                                    style={{
                                      background: "none",
                                      border: "1px dashed #ddd9d0",
                                      borderRadius: 4,
                                      padding: "4px 10px",
                                      fontSize: 11,
                                      color: "#6b6b76",
                                      cursor: "pointer",
                                      fontFamily: "inherit",
                                      textAlign: "left",
                                      maxWidth: 120,
                                    }}
                                  >
                                    + Add alias
                                  </button>
                                </div>
                              </div>

                              {/* Save / Cancel / Remove */}
                              <div style={{ display: "flex", gap: 8 }}>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={handleSaveEdit}
                                  disabled={editSaving || !editForm.name.trim()}
                                >
                                  {editSaving ? "Saving..." : "Save"}
                                </Button>
                                <Button size="sm" onClick={cancelEdit}>
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleRemove(entry.id)}
                                  style={{ background: "rgba(199,62,62,0.08)", color: "#c73e3e", border: "1px solid rgba(199,62,62,0.2)" }}
                                >
                                  Remove
                                </Button>
                              </div>
                            </div>
                          ) : (
                            /* ---- Detail view ---- */
                            <div>
                              {/* Info grid */}
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                                {/* Email */}
                                <div>
                                  <div style={labelStyle}>Email</div>
                                  <div style={{ fontSize: 13, color: entry.email ? "#1a1a1f" : "#9494a0" }}>
                                    {entry.email || "Not set"}
                                  </div>
                                </div>

                                {/* Used In */}
                                <div>
                                  <div style={labelStyle}>Used In</div>
                                  {entry.usage_count > 0
                                    ? (
                                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        {entry.usage_details.split(", ").map((part, i) => (
                                          <span
                                            key={i}
                                            style={{
                                              background: "rgba(45,90,61,0.06)",
                                              color: "#2d5a3d",
                                              padding: "2px 8px",
                                              borderRadius: 4,
                                              fontSize: 12,
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            {part}
                                          </span>
                                        ))}
                                      </div>
                                    )
                                    : <div style={{ fontSize: 13, color: "#9494a0" }}>Not referenced</div>
                                  }
                                </div>

                                {/* AKA */}
                                <div>
                                  <div style={labelStyle}>Also Known As</div>
                                  {hasAliases
                                    ? (
                                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                        {entry.aliases.map((alias, i) => (
                                          <span
                                            key={i}
                                            style={{
                                              background: "rgba(107,107,118,0.08)",
                                              padding: "2px 8px",
                                              borderRadius: 4,
                                              fontSize: 12,
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            {alias}
                                          </span>
                                        ))}
                                      </div>
                                    )
                                    : <div style={{ fontSize: 13, color: "#9494a0" }}>None</div>
                                  }
                                </div>
                              </div>

                              {/* Action buttons */}
                              <div style={{ display: "flex", gap: 8 }}>
                                <Button size="sm" onClick={() => startEdit(entry)}>
                                  Edit
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Bottom note */}
      {/* ----------------------------------------------------------------- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 16,
          padding: "10px 14px",
          background: "rgba(51,102,168,0.05)",
          borderRadius: 8,
          border: "1px solid rgba(51,102,168,0.12)",
          fontSize: 12,
          color: "#6b6b76",
        }}
      >
        <BuildingIcon size={16} />
        <span>
          Internal entities ({internalCount}) are automatically available in all member/manager picklists
        </span>
      </div>
    </div>
  );
}
