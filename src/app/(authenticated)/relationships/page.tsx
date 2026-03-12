"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowIcon, PlusIcon, XIcon, DocIcon, UploadIcon } from "@/components/ui/icons";
import { formatMoney, formatDateShort } from "@/lib/utils/format";
import { RELATIONSHIP_TYPE_COLORS } from "@/lib/utils/entity-colors";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPE_CATEGORIES } from "@/lib/constants";
import type { DocumentType } from "@/lib/types/enums";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Relationship {
  id: string;
  type: string;
  description: string | null;
  terms: string | null;
  from_entity_id: string | null;
  from_directory_id: string | null;
  to_entity_id: string | null;
  to_directory_id: string | null;
  from_name: string;
  to_name: string;
  frequency: string | null;
  status: string | null;
  effective_date: string | null;
  end_date: string | null;
  annual_estimate: number | null;
  document_ref: string | null;
  notes: string | null;
  created_at: string;
}

interface PicklistItem {
  id: string;
  name: string;
  source: "entity" | "directory";
  source_type: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const RELATIONSHIP_TYPES = [
  { value: "profit_share", label: "Profit Share" },
  { value: "fixed_fee", label: "Fixed Fee" },
  { value: "management_fee", label: "Mgmt Fee" },
  { value: "performance_fee", label: "Perf Fee" },
  { value: "equity", label: "Equity" },
  { value: "loan", label: "Loan" },
  { value: "guarantee", label: "Guarantee" },
  { value: "service_agreement", label: "Service Agreement" },
  { value: "license", label: "License" },
  { value: "lease", label: "Lease" },
  { value: "other", label: "Other" },
];

const FREQUENCY_OPTIONS = [
  { value: "", label: "None" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-Annual" },
  { value: "annual", label: "Annual" },
  { value: "one_time", label: "One-Time" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "terminated", label: "Closed" },
];

const FILTER_TYPES = [
  { value: "all", label: "All" },
  { value: "profit_share", label: "Profit Share" },
  { value: "fixed_fee", label: "Fixed Fee" },
  { value: "management_fee", label: "Mgmt Fee" },
  { value: "equity", label: "Equity" },
  { value: "loan", label: "Loan" },
];

const EMPTY_FORM = {
  type: "profit_share",
  description: "",
  terms: "",
  from_source: "" as string,
  to_source: "" as string,
  frequency: "",
  status: "active",
  effective_date: "",
  end_date: "",
  annual_estimate_dollars: "",
  notes: "",
  document_file: null as File | null,
  document_type: "" as DocumentType | "",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Returns true if the relationship is considered "Active" for display */
function isActive(status: string | null): boolean {
  return status === "active";
}

/** Build a picklist value like "entity:uuid" from a relationship's party fields */
function picklistValueFromRel(
  entityId: string | null,
  directoryId: string | null
): string {
  if (entityId) return `entity:${entityId}`;
  if (directoryId) return `directory:${directoryId}`;
  return "";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RelationshipsPage() {
  const isMobile = useIsMobile();

  // Data
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [picklist, setPicklist] = useState<PicklistItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [partyFilter, setPartyFilter] = useState("all");

  // New relationship form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  // Expand / edit
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);

  // -------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------

  const fetchRelationships = useCallback(async () => {
    try {
      const res = await fetch("/api/relationships");
      if (!res.ok) throw new Error("Failed to fetch relationships");
      const data: Relationship[] = await res.json();
      setRelationships(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPicklist = useCallback(async () => {
    try {
      const res = await fetch("/api/directory/picklist");
      if (!res.ok) throw new Error("Failed to fetch picklist");
      const data: PicklistItem[] = await res.json();
      setPicklist(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchRelationships();
    fetchPicklist();
  }, [fetchRelationships, fetchPicklist]);

  const setPageContext = useSetPageContext();
  useEffect(() => {
    setPageContext({ page: "relationships" });
    return () => setPageContext(null);
  }, [setPageContext]);

  // -------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------

  const filtered = useMemo(() => {
    return relationships.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (partyFilter !== "all") {
        const match =
          r.from_name === partyFilter || r.to_name === partyFilter;
        if (!match) return false;
      }
      return true;
    });
  }, [relationships, typeFilter, partyFilter]);

  const allPartyNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of relationships) {
      names.add(r.from_name);
      names.add(r.to_name);
    }
    return Array.from(names).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [relationships]);

  // -------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------

  const handleSave = async () => {
    if (!form.type || !form.from_source || !form.to_source) return;
    setSaving(true);
    try {
      // Parse from_source and to_source which are formatted as "source:id"
      const [fromSource, fromId] = form.from_source.split(":");
      const [toSource, toId] = form.to_source.split(":");

      const payload: Record<string, unknown> = {
        type: form.type,
        description: form.description || null,
        terms: form.terms || null,
        from_entity_id: fromSource === "entity" ? fromId : null,
        from_directory_id: fromSource === "directory" ? fromId : null,
        to_entity_id: toSource === "entity" ? toId : null,
        to_directory_id: toSource === "directory" ? toId : null,
        frequency: form.frequency || null,
        status: form.status || "active",
        effective_date: form.effective_date || null,
        end_date: form.end_date || null,
        annual_estimate: form.annual_estimate_dollars
          ? Math.round(parseFloat(form.annual_estimate_dollars) * 100)
          : null,
        notes: form.notes || null,
      };

      const res = await fetch("/api/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to create relationship");

      // Upload document if provided
      if (form.document_file && form.document_type) {
        try {
          const relData = await res.json();
          const relationshipId = relData.id;

          // Determine which entity to attach the document to
          const entityId = fromSource === "entity" ? fromId : toSource === "entity" ? toId : null;
          if (entityId) {
            const formData = new FormData();
            formData.append("file", form.document_file);
            formData.append("document_type", form.document_type);
            formData.append("name", form.document_file.name.replace(/\.[^/.]+$/, ""));
            formData.append("relationship_id", relationshipId);

            await fetch(`/api/entities/${entityId}/documents`, {
              method: "POST",
              body: formData,
            });
          }
        } catch (docErr) {
          console.error("Failed to upload document:", docErr);
        }
      }

      setShowForm(false);
      setForm(EMPTY_FORM);
      await fetchRelationships();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this relationship?")) return;
    try {
      const res = await fetch(`/api/relationships/${id}?hard=true`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete relationship");
      setExpandedId(null);
      setEditingId(null);
      await fetchRelationships();
    } catch (err) {
      console.error(err);
    }
  };

  /** Populate the edit form from an existing relationship */
  const startEditing = (rel: Relationship) => {
    setEditingId(rel.id);
    setEditForm({
      type: rel.type,
      description: rel.description || "",
      terms: rel.terms || "",
      from_source: picklistValueFromRel(rel.from_entity_id, rel.from_directory_id),
      to_source: picklistValueFromRel(rel.to_entity_id, rel.to_directory_id),
      frequency: rel.frequency || "",
      status: rel.status || "active",
      effective_date: rel.effective_date || "",
      end_date: rel.end_date || "",
      annual_estimate_dollars:
        rel.annual_estimate !== null && rel.annual_estimate !== 0
          ? (rel.annual_estimate / 100).toString()
          : "",
      notes: rel.notes || "",
      document_file: null,
      document_type: "",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
  };

  const handleEditSave = async (id: string) => {
    setEditSaving(true);
    try {
      const [fromSource, fromId] = editForm.from_source.split(":");
      const [toSource, toId] = editForm.to_source.split(":");

      const payload: Record<string, unknown> = {
        type: editForm.type,
        description: editForm.description || null,
        terms: editForm.terms || null,
        from_entity_id: fromSource === "entity" ? fromId : null,
        from_directory_id: fromSource === "directory" ? fromId : null,
        to_entity_id: toSource === "entity" ? toId : null,
        to_directory_id: toSource === "directory" ? toId : null,
        frequency: editForm.frequency || null,
        status: editForm.status || "active",
        effective_date: editForm.effective_date || null,
        end_date: editForm.end_date || null,
        annual_estimate: editForm.annual_estimate_dollars
          ? Math.round(parseFloat(editForm.annual_estimate_dollars) * 100)
          : null,
        notes: editForm.notes || null,
      };

      const res = await fetch(`/api/relationships/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to update relationship");

      setEditingId(null);
      setEditForm(EMPTY_FORM);
      await fetchRelationships();
    } catch (err) {
      console.error(err);
    } finally {
      setEditSaving(false);
    }
  };

  const handleCloseRelationship = async (id: string) => {
    setEditSaving(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const payload = {
        status: "terminated",
        end_date: today,
      };
      const res = await fetch(`/api/relationships/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to close relationship");

      setEditingId(null);
      setEditForm(EMPTY_FORM);
      await fetchRelationships();
    } catch (err) {
      console.error(err);
    } finally {
      setEditSaving(false);
    }
  };

  // -------------------------------------------------------------------
  // Styles
  // -------------------------------------------------------------------

  const inputStyle: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
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

  // -------------------------------------------------------------------
  // Status indicator sub-component
  // -------------------------------------------------------------------

  const StatusDot = ({ status }: { status: string | null }) => {
    const active = isActive(status);
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11,
          fontWeight: 600,
          color: active ? "#2d5a3d" : "#c73e3e",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: active ? "#2d5a3d" : "#c73e3e",
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        {active ? "Active" : "Closed"}
      </span>
    );
  };

  // -------------------------------------------------------------------
  // Detail row helper
  // -------------------------------------------------------------------

  const DetailRow = ({
    label,
    value,
  }: {
    label: string;
    value: React.ReactNode;
  }) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "#1a1a1f" }}>
        {value || <span style={{ color: "#9494a0" }}>&mdash;</span>}
      </div>
    </div>
  );

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1f" }}>
          Relationships & Contracts
        </div>
        <div style={{ color: "#9494a0", marginTop: 12 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* ----------------------------------------------------------------- */}
      {/* Header                                                             */}
      {/* ----------------------------------------------------------------- */}
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          justifyContent: "space-between",
          alignItems: isMobile ? "stretch" : "flex-start",
          gap: isMobile ? 12 : 0,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#1a1a1f",
              margin: 0,
            }}
          >
            Relationships & Contracts
          </h1>
          <p style={{ fontSize: 13, color: "#9494a0", margin: "4px 0 0" }}>
            {relationships.length} relationship{relationships.length !== 1 ? "s" : ""} across your entities
          </p>
        </div>
        {!showForm && (
          <Button variant="primary" onClick={() => setShowForm(true)}>
            <PlusIcon size={14} /> New Relationship
          </Button>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* New relationship form                                              */}
      {/* ----------------------------------------------------------------- */}
      {showForm && (
        <Card style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "#1a1a1f",
              marginBottom: 16,
            }}
          >
            New Relationship
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
              gap: 14,
            }}
          >
            {/* Type */}
            <div>
              <label style={labelStyle}>Type</label>
              <select
                style={selectStyle}
                value={form.type}
                onChange={(e) =>
                  setForm((f) => ({ ...f, type: e.target.value }))
                }
              >
                {RELATIONSHIP_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label style={labelStyle}>Status</label>
              <select
                style={selectStyle}
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value }))
                }
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            {/* From Party */}
            <div>
              <label style={labelStyle}>From Party</label>
              <select
                style={selectStyle}
                value={form.from_source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, from_source: e.target.value }))
                }
              >
                <option value="">Select a party...</option>
                {picklist.map((p) => (
                  <option key={`${p.source}:${p.id}`} value={`${p.source}:${p.id}`}>
                    {p.name} ({p.source === "entity" ? "Entity" : "Directory"})
                  </option>
                ))}
              </select>
            </div>

            {/* To Party */}
            <div>
              <label style={labelStyle}>To Party</label>
              <select
                style={selectStyle}
                value={form.to_source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, to_source: e.target.value }))
                }
              >
                <option value="">Select a party...</option>
                {picklist.map((p) => (
                  <option key={`${p.source}:${p.id}`} value={`${p.source}:${p.id}`}>
                    {p.name} ({p.source === "entity" ? "Entity" : "Directory"})
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Description</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Brief description of the relationship"
              />
            </div>

            {/* Terms */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Terms</label>
              <input
                style={inputStyle}
                value={form.terms}
                onChange={(e) =>
                  setForm((f) => ({ ...f, terms: e.target.value }))
                }
                placeholder="e.g. 20% of profits, $50K/year"
              />
            </div>

            {/* Frequency */}
            <div>
              <label style={labelStyle}>Frequency</label>
              <select
                style={selectStyle}
                value={form.frequency}
                onChange={(e) =>
                  setForm((f) => ({ ...f, frequency: e.target.value }))
                }
              >
                {FREQUENCY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Annual Estimate */}
            <div>
              <label style={labelStyle}>Annual Estimate ($)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={form.annual_estimate_dollars}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    annual_estimate_dollars: e.target.value,
                  }))
                }
                placeholder="e.g. 50000"
              />
            </div>

            {/* Effective Date */}
            <div>
              <label style={labelStyle}>Effective Date</label>
              <input
                style={inputStyle}
                type="date"
                value={form.effective_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, effective_date: e.target.value }))
                }
              />
            </div>

            {/* End Date */}
            <div>
              <label style={labelStyle}>End Date</label>
              <input
                style={inputStyle}
                type="date"
                value={form.end_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, end_date: e.target.value }))
                }
              />
            </div>

            {/* Document Upload */}
            <div>
              <label style={labelStyle}>Document</label>
              <input
                ref={docFileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setForm((f) => ({ ...f, document_file: file }));
                }}
              />
              {form.document_file ? (
                <div
                  style={{
                    border: "1px solid #ddd9d0",
                    borderRadius: 6,
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "#1a1a1f",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#fafaf7",
                  }}
                >
                  <DocIcon size={14} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {form.document_file.name}
                  </span>
                  <button
                    onClick={() => setForm((f) => ({ ...f, document_file: null, document_type: "" }))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#c73e3e", padding: 2 }}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => docFileInputRef.current?.click()}
                  style={{
                    border: "1px dashed #ddd9d0",
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "#9494a0",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    background: "#fafaf7",
                  }}
                >
                  <UploadIcon size={14} />
                  Click to attach a document
                </div>
              )}
            </div>

            {/* Document Type (shown when file selected) */}
            {form.document_file && (
              <div>
                <label style={labelStyle}>Document Type</label>
                <select
                  style={selectStyle}
                  value={form.document_type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, document_type: e.target.value as DocumentType | "" }))
                  }
                >
                  <option value="">Select type...</option>
                  {Object.entries(DOCUMENT_TYPE_CATEGORIES).map(([catKey, cat]) => (
                    <optgroup key={catKey} label={cat.label}>
                      {cat.types.map((t) => (
                        <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}

            {/* Notes */}
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Notes</label>
              <input
                style={inputStyle}
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Optional notes"
              />
            </div>
          </div>

          {/* Actions */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 16,
              justifyContent: "flex-end",
            }}
          >
            <Button
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
            >
              <XIcon size={12} /> Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving || !form.type || !form.from_source || !form.to_source}
            >
              {saving ? "Saving..." : "Save Relationship"}
            </Button>
          </div>
        </Card>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Filters                                                            */}
      {/* ----------------------------------------------------------------- */}
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          justifyContent: "space-between",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 10 : 0,
          marginBottom: 16,
        }}
      >
        {/* Type filter pills */}
        <div style={{ display: "flex", gap: 4, overflowX: isMobile ? "auto" : undefined, flexWrap: isMobile ? "nowrap" : undefined, WebkitOverflowScrolling: isMobile ? "touch" : undefined } as React.CSSProperties}>
          {FILTER_TYPES.map((ft) => {
            const isActive = typeFilter === ft.value;
            const count =
              ft.value === "all"
                ? relationships.length
                : relationships.filter((r) => r.type === ft.value).length;
            return (
              <button
                key={ft.value}
                onClick={() => setTypeFilter(ft.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: isActive ? "1px solid #2d5a3d" : "1px solid #e8e6df",
                  background: isActive ? "rgba(45,90,61,0.08)" : "#ffffff",
                  color: isActive ? "#2d5a3d" : "#6b6b76",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                {ft.label}
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: isActive ? "#2d5a3d" : "#9494a0",
                    background: isActive
                      ? "rgba(45,90,61,0.12)"
                      : "rgba(148,148,160,0.12)",
                    padding: "1px 6px",
                    borderRadius: 4,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Party dropdown filter */}
        <select
          style={{
            ...selectStyle,
            width: isMobile ? "100%" : 200,
            fontSize: 12,
          }}
          value={partyFilter}
          onChange={(e) => setPartyFilter(e.target.value)}
        >
          <option value="all">All Parties</option>
          {allPartyNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Card list                                                          */}
      {/* ----------------------------------------------------------------- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 20px",
              color: "#9494a0",
              fontSize: 13,
            }}
          >
            {typeFilter !== "all" || partyFilter !== "all"
              ? "No relationships match your filters."
              : "No relationships yet. Click \"New Relationship\" to get started."}
          </div>
        )}

        {filtered.map((rel) => {
          const typeInfo = RELATIONSHIP_TYPE_COLORS[rel.type] ?? RELATIONSHIP_TYPE_COLORS.other;
          const expanded = expandedId === rel.id;
          const editing = editingId === rel.id;

          return (
            <Card
              key={rel.id}
              style={{
                padding: isMobile ? "14px 16px" : "16px 22px",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#c8c5bb";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#e8e6df";
              }}
            >
              {/* ---- Summary row (always visible) ---- */}
              <div
                onClick={() => {
                  if (editing) return; // don't collapse while editing
                  setExpandedId(expanded ? null : rel.id);
                  if (expanded) {
                    setEditingId(null);
                    setEditForm(EMPTY_FORM);
                  }
                }}
                style={isMobile ? {} : {
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                {isMobile ? (
                  /* ---- Mobile: stacked card layout ---- */
                  <div>
                    {/* Entity A name */}
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1f" }}>
                      {rel.from_name}
                    </div>

                    {/* Relationship type label with arrow */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "6px 0" }}>
                      <Badge
                        label={typeInfo.label}
                        color={typeInfo.color}
                        bg={typeInfo.bg}
                      />
                      <span style={{ fontSize: 12, color: "#9494a0" }}>
                        <ArrowIcon size={12} />
                      </span>
                      <StatusDot status={rel.status} />
                    </div>

                    {/* Entity B name */}
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1f", marginBottom: 4 }}>
                      {rel.to_name}
                    </div>

                    {/* Description */}
                    {rel.description && (
                      <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 4 }}>
                        {rel.description}
                      </div>
                    )}

                    {/* Amount + frequency row */}
                    {(rel.annual_estimate !== null && rel.annual_estimate !== 0) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: typeInfo.color }}>
                          {formatMoney(rel.annual_estimate)}
                        </span>
                        {rel.frequency && (
                          <span style={{ fontSize: 11, color: "#9494a0", fontWeight: 500 }}>
                            {rel.frequency.replace("_", "-")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ---- Desktop: horizontal layout ---- */
                  <>
                    {/* Left side */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Top row: badge + status + frequency + date */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <Badge
                          label={typeInfo.label}
                          color={typeInfo.color}
                          bg={typeInfo.bg}
                        />
                        <StatusDot status={rel.status} />
                        {rel.frequency && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#9494a0",
                              fontWeight: 500,
                            }}
                          >
                            {rel.frequency.replace("_", "-")}
                          </span>
                        )}
                        {rel.effective_date && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#9494a0",
                            }}
                          >
                            {formatDateShort(rel.effective_date)}
                          </span>
                        )}
                      </div>

                      {/* From -> To */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#1a1a1f",
                          marginBottom: 4,
                        }}
                      >
                        <span>{rel.from_name}</span>
                        <ArrowIcon size={14} />
                        <span>{rel.to_name}</span>
                      </div>

                      {/* Description */}
                      {rel.description && (
                        <div
                          style={{
                            fontSize: 13,
                            color: "#6b6b76",
                            marginBottom: 2,
                          }}
                        >
                          {rel.description}
                        </div>
                      )}

                      {/* Terms */}
                      {rel.terms && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "#9494a0",
                          }}
                        >
                          {rel.terms}
                        </div>
                      )}
                    </div>

                    {/* Right side: amount */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 8,
                        marginLeft: 20,
                        flexShrink: 0,
                      }}
                    >
                      {rel.annual_estimate !== null && rel.annual_estimate !== 0 && (
                        <div
                          style={{
                            fontSize: 20,
                            fontWeight: 700,
                            fontFamily: "'DM Mono', monospace",
                            color: typeInfo.color,
                          }}
                        >
                          {formatMoney(rel.annual_estimate)}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ---- Expanded detail view ---- */}
              {expanded && !editing && (
                <div style={{ marginTop: 16, borderTop: "1px solid #e8e6df", paddingTop: 16 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                      gap: isMobile ? 12 : "14px 24px",
                    }}
                  >
                    <DetailRow
                      label="Type"
                      value={
                        RELATIONSHIP_TYPES.find((t) => t.value === rel.type)
                          ?.label ?? rel.type
                      }
                    />
                    <DetailRow
                      label="Status"
                      value={<StatusDot status={rel.status} />}
                    />
                    <DetailRow
                      label="Frequency"
                      value={
                        rel.frequency
                          ? FREQUENCY_OPTIONS.find((f) => f.value === rel.frequency)?.label ?? rel.frequency
                          : null
                      }
                    />
                    <DetailRow label="From Party" value={rel.from_name} />
                    <DetailRow label="To Party" value={rel.to_name} />
                    <DetailRow label="Description" value={rel.description} />
                    <DetailRow label="Terms" value={rel.terms} />
                    <DetailRow
                      label="Effective Date"
                      value={
                        rel.effective_date
                          ? formatDateShort(rel.effective_date)
                          : null
                      }
                    />
                    <DetailRow
                      label="End Date"
                      value={
                        rel.end_date
                          ? formatDateShort(rel.end_date)
                          : null
                      }
                    />
                    <DetailRow
                      label="Annual Estimate"
                      value={
                        rel.annual_estimate !== null && rel.annual_estimate !== 0
                          ? formatMoney(rel.annual_estimate)
                          : null
                      }
                    />
                    <DetailRow label="Notes" value={rel.notes} />
                  </div>

                  {/* Edit button */}
                  <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                    <Button onClick={() => startEditing(rel)}>
                      Edit
                    </Button>
                  </div>
                </div>
              )}

              {/* ---- Inline edit form ---- */}
              {expanded && editing && (
                <div style={{ marginTop: 16, borderTop: "1px solid #e8e6df", paddingTop: 16 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                      gap: 14,
                    }}
                  >
                    {/* Type */}
                    <div>
                      <label style={labelStyle}>Type</label>
                      <select
                        style={selectStyle}
                        value={editForm.type}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, type: e.target.value }))
                        }
                      >
                        {RELATIONSHIP_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Status */}
                    <div>
                      <label style={labelStyle}>Status</label>
                      <select
                        style={selectStyle}
                        value={editForm.status}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, status: e.target.value }))
                        }
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* From Party */}
                    <div>
                      <label style={labelStyle}>From Party</label>
                      <select
                        style={selectStyle}
                        value={editForm.from_source}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            from_source: e.target.value,
                          }))
                        }
                      >
                        <option value="">Select a party...</option>
                        {picklist.map((p) => (
                          <option
                            key={`${p.source}:${p.id}`}
                            value={`${p.source}:${p.id}`}
                          >
                            {p.name} ({p.source === "entity" ? "Entity" : "Directory"})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* To Party */}
                    <div>
                      <label style={labelStyle}>To Party</label>
                      <select
                        style={selectStyle}
                        value={editForm.to_source}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            to_source: e.target.value,
                          }))
                        }
                      >
                        <option value="">Select a party...</option>
                        {picklist.map((p) => (
                          <option
                            key={`${p.source}:${p.id}`}
                            value={`${p.source}:${p.id}`}
                          >
                            {p.name} ({p.source === "entity" ? "Entity" : "Directory"})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Description */}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle}>Description</label>
                      <input
                        style={inputStyle}
                        value={editForm.description}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            description: e.target.value,
                          }))
                        }
                        placeholder="Brief description of the relationship"
                      />
                    </div>

                    {/* Terms */}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle}>Terms</label>
                      <input
                        style={inputStyle}
                        value={editForm.terms}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            terms: e.target.value,
                          }))
                        }
                        placeholder="e.g. 20% of profits, $50K/year"
                      />
                    </div>

                    {/* Frequency */}
                    <div>
                      <label style={labelStyle}>Frequency</label>
                      <select
                        style={selectStyle}
                        value={editForm.frequency}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            frequency: e.target.value,
                          }))
                        }
                      >
                        {FREQUENCY_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Annual Estimate */}
                    <div>
                      <label style={labelStyle}>Annual Estimate ($)</label>
                      <input
                        style={inputStyle}
                        type="number"
                        min="0"
                        step="0.01"
                        value={editForm.annual_estimate_dollars}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            annual_estimate_dollars: e.target.value,
                          }))
                        }
                        placeholder="e.g. 50000"
                      />
                    </div>

                    {/* Effective Date */}
                    <div>
                      <label style={labelStyle}>Effective Date</label>
                      <input
                        style={inputStyle}
                        type="date"
                        value={editForm.effective_date}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            effective_date: e.target.value,
                          }))
                        }
                      />
                    </div>

                    {/* End Date */}
                    <div>
                      <label style={labelStyle}>End Date</label>
                      <input
                        style={inputStyle}
                        type="date"
                        value={editForm.end_date}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            end_date: e.target.value,
                          }))
                        }
                      />
                    </div>

                    {/* Notes */}
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={labelStyle}>Notes</label>
                      <input
                        style={inputStyle}
                        value={editForm.notes}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            notes: e.target.value,
                          }))
                        }
                        placeholder="Optional notes"
                      />
                    </div>
                  </div>

                  {/* Edit actions */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: isMobile ? "column" : "row",
                      gap: 8,
                      marginTop: 16,
                      justifyContent: "space-between",
                      alignItems: isMobile ? "stretch" : "center",
                    }}
                  >
                    {/* Left: destructive actions */}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => handleDelete(rel.id)}
                        style={{
                          background: "none",
                          border: "1px solid #c73e3e",
                          borderRadius: 6,
                          padding: "6px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#c73e3e",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Delete
                      </button>
                      {isActive(rel.status) && (
                        <button
                          onClick={() => handleCloseRelationship(rel.id)}
                          disabled={editSaving}
                          style={{
                            background: "none",
                            border: "1px solid #9494a0",
                            borderRadius: 6,
                            padding: "6px 14px",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#6b6b76",
                            cursor: editSaving ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          Close Relationship
                        </button>
                      )}
                    </div>

                    {/* Right: save / cancel */}
                    <div style={{ display: "flex", gap: 8, justifyContent: isMobile ? "flex-start" : undefined }}>
                      <Button onClick={cancelEditing}>
                        <XIcon size={12} /> Cancel
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => handleEditSave(rel.id)}
                        disabled={editSaving}
                      >
                        {editSaving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
