"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import type { QueueItem } from "@/lib/types/entities";

// --- Shared constants (mirrored from entity page) ---

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create_entity: { label: "Create Entity", color: "#2d5a3d" },
  update_entity: { label: "Update Entity", color: "#3366a8" },
  create_relationship: { label: "Create Relationship", color: "#7b4db5" },
  add_member: { label: "Add Member", color: "#2d8a4e" },
  add_manager: { label: "Add Manager", color: "#2d5a3d" },
  add_registration: { label: "Add Registration", color: "#c47520" },
  update_registration: { label: "Update Filing", color: "#c47520" },
  add_trust_role: { label: "Add Trust Role", color: "#c47520" },
  update_trust_details: { label: "Update Trust Details", color: "#c47520" },
  update_cap_table: { label: "Update Cap Table", color: "#3366a8" },
  create_directory_entry: { label: "Create Directory Entry", color: "#2d8a4e" },
  add_custom_field: { label: "Add Custom Field", color: "#6b6b76" },
  add_partnership_rep: { label: "Add Partnership Rep", color: "#2d8a4e" },
  add_role: { label: "Add Role", color: "#7b4db5" },
  complete_obligation: { label: "Complete Obligation", color: "#2d5a3d" },
  update_obligation: { label: "Update Obligation", color: "#c47520" },
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name", type: "Type", ein: "EIN", formation_state: "Formation State",
  formed_date: "Formation Date", address: "Address", registered_agent: "Registered Agent",
  notes: "Notes", description: "Description", terms: "Terms", frequency: "Payment Frequency",
  annual_estimate: "Annual Estimate", ownership_pct: "Ownership %",
  capital_contributed: "Capital Contributed", units: "Units",
  investor_name: "Investor Name", investor_type: "Investor Type",
  replaces_investor_name: "Replaces", jurisdiction: "Jurisdiction",
  qualification_date: "Qualification Date", last_filing_date: "Last Filing Date",
  state_id: "State Filing #", role: "Role", trust_type: "Trust Type",
  trust_date: "Trust Date", grantor_name: "Grantor", situs_state: "Situs State",
  email: "Email", label: "Label", value: "Value", status: "Status",
  business_purpose: "Business Purpose", role_title: "Role Title",
  completed_at: "Completed At", payment_amount: "Payment Amount",
  confirmation: "Confirmation #",
};

const HIDDEN_ID_FIELDS = new Set([
  "entity_id", "trust_detail_id", "registration_id", "from_entity_id",
  "to_entity_id", "from_directory_id", "to_directory_id", "investor_entity_id",
  "investor_directory_id", "field_def_id", "obligation_id",
]);

function getFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// --- Component ---

interface ApprovalCardProps {
  item: QueueItem;
  entities: Array<{ id: string; name: string }>;
  onApprove: (itemId: string, excludedActionIndices?: number[]) => Promise<void>;
  onIngestOnly: (itemId: string) => Promise<void>;
  onAssignEntity: (itemId: string, entityId: string) => Promise<void>;
}

export function ApprovalCard({ item, entities, onApprove, onIngestOnly, onAssignEntity }: ApprovalCardProps) {
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [selectedEntityId, setSelectedEntityId] = useState(item.staged_entity_id || "");

  // Sync when staged_entity_id updates (e.g. after sibling entity creation)
  useEffect(() => {
    if (item.staged_entity_id && !selectedEntityId) {
      setSelectedEntityId(item.staged_entity_id);
    }
  }, [item.staged_entity_id, selectedEntityId]);

  const reason = item.approval_reason || "database_mutations";
  const docName = item.ai_suggested_name || item.original_filename;
  const docType = item.ai_document_type || item.staged_doc_type || "other";
  const docTypeLabel = DOCUMENT_TYPE_LABELS[docType] || docType;

  const handleAction = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  };

  const actions = ((item.ai_proposed_actions || []) as Array<{
    action: string;
    data: Record<string, unknown>;
    reason?: string;
    confidence?: string;
  }>).filter((a) => a.action !== "create_entity");

  // Format actions into human-readable one-liner strings (for compact view)
  const formatAction = (action: { action: string; data: Record<string, unknown>; reason?: string }) => {
    switch (action.action) {
      case "add_member": return `Add member: ${action.data.name}`;
      case "add_manager": return `Add manager: ${action.data.name}`;
      case "add_registration": return `Add registration: ${action.data.jurisdiction}${action.data.qualification_date ? ` (${action.data.qualification_date})` : ""}`;
      case "update_registration": return `Update registration: last filed ${action.data.last_filing_date || "unknown"}`;
      case "update_entity": {
        const fields = action.data.fields as Record<string, unknown>;
        const changes = Object.entries(fields || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
        return `Update entity: ${changes}`;
      }
      case "update_cap_table": return `Update cap table: ${action.data.investor_name} (${action.data.ownership_pct}%)`;
      case "create_relationship": return `Create relationship: ${action.data.type} — ${action.data.description || ""}`;
      case "add_trust_role": return `Add trust role: ${action.data.role} = ${action.data.name}`;
      case "update_trust_details": return `Update trust details`;
      case "complete_obligation": return `Complete obligation: filed ${action.data.completed_at || ""}`;
      case "add_partnership_rep": return `Add partnership rep: ${action.data.name}`;
      case "add_role": return `Add role: ${action.data.role_title} = ${action.data.name}`;
      default: return `${action.action}: ${action.reason || ""}`;
    }
  };

  const toggleAction = (index: number) => {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectedCount = actions.length - unchecked.size;

  const inputStyle: React.CSSProperties = {
    background: "#fafaf7",
    border: "1px solid #ddd9d0",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    color: "#1a1a1f",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  };

  // --- New Entity ---
  if (reason === "new_entity") {
    const proposed = item.ai_proposed_entity as Record<string, unknown> | null;
    return (
      <div style={{ border: "1px solid #e8e6df", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafaf7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: "#b08000", fontSize: 14 }}>&#9888;</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>New Entity: &ldquo;{String(proposed?.name || "Unknown")}&rdquo;</span>
        </div>
        <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
          AI found references to an entity not in the database.
        </div>
        <div style={{ background: "white", border: "1px solid #e8e6df", borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#6b6b76" }}>
            {proposed?.type ? <div>Type: {String(proposed.type)}</div> : null}
            {proposed?.formation_state ? <div>State: {String(proposed.formation_state)}</div> : null}
            <div style={{ marginTop: 4 }}>Document: {docName} ({docTypeLabel}{item.ai_year ? `, ${item.ai_year}` : ""})</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="primary" disabled={loading} onClick={() => handleAction(() => onApprove(item.id))}>
            {loading ? "Creating..." : "Create Entity & Ingest"}
          </Button>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => handleAction(() => onIngestOnly(item.id))}>
            Skip
          </Button>
        </div>
      </div>
    );
  }

  // --- Database Mutations ---
  if (reason === "database_mutations") {
    const entityId = item.ai_entity_id;
    const entity = entities.find((e) => e.id === entityId);
    const entityName = entity?.name || item.staged_entity_name || "Unknown Entity";

    // Detailed review mode
    if (reviewing) {
      return (
        <div style={{ border: "1px solid rgba(45,90,61,0.3)", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafaf7" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 14 }}>&#10024;</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>
              AI found {actions.length} proposed change{actions.length !== 1 ? "s" : ""} from &ldquo;{docName}&rdquo;
            </span>
          </div>
          {item.ai_summary && (
            <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12, marginLeft: 22, lineHeight: 1.5 }}>
              {item.ai_summary}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {actions.map((action, idx) => {
              const isChecked = !unchecked.has(idx);
              const actionInfo = ACTION_LABELS[action.action] || { label: action.action, color: "#6b6b76" };
              const isUpdateEntity = action.action === "update_entity";
              const updateFields = isUpdateEntity && action.data.fields
                ? (action.data.fields as Record<string, unknown>)
                : null;

              const visibleEntries = Object.entries(action.data).filter(([key]) => {
                if (HIDDEN_ID_FIELDS.has(key)) return false;
                if (isUpdateEntity && key === "fields") return false;
                return true;
              });

              return (
                <div
                  key={idx}
                  style={{
                    border: "1px solid #e8e6df",
                    borderRadius: 8,
                    padding: 14,
                    background: isChecked ? "rgba(45,90,61,0.02)" : "#f5f4f0",
                    opacity: isChecked ? 1 : 0.6,
                  }}
                >
                  {/* Header: checkbox + action label + confidence */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleAction(idx)}
                      style={{ accentColor: "#2d5a3d" }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: actionInfo.color,
                        background: hexToRgba(actionInfo.color, 0.1),
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {actionInfo.label}
                    </span>
                    {action.confidence && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: action.confidence === "high" ? "#2d5a3d" : action.confidence === "medium" ? "#c47520" : "#c73e3e",
                          background: action.confidence === "high" ? "rgba(45,90,61,0.10)" : action.confidence === "medium" ? "rgba(196,117,32,0.10)" : "rgba(199,62,62,0.10)",
                          padding: "2px 8px",
                          borderRadius: 4,
                          textTransform: "capitalize",
                        }}
                      >
                        {action.confidence}
                      </span>
                    )}
                  </div>

                  {/* update_entity: show fields sub-object */}
                  {isUpdateEntity && updateFields && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                      {Object.entries(updateFields).map(([key, val]) => (
                        <div key={key} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              {getFieldLabel(key)}
                            </label>
                            <input style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }} value={String(val ?? "")} readOnly />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Non-update actions: show data fields in grid */}
                  {!isUpdateEntity && visibleEntries.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                      {visibleEntries.map(([key, val]) => (
                        <div key={key}>
                          <label style={{ display: "block", fontSize: 10, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            {getFieldLabel(key)}
                          </label>
                          <input style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }} value={String(val ?? "")} readOnly />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reason */}
                  {action.reason && (
                    <div style={{ fontSize: 12, color: "#6b6b76", fontStyle: "italic" }}>
                      {action.reason
                        .replace(/\s*\(id:\s*[0-9a-f-]{36}\)/gi, "")
                        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "")
                        .replace(/\s{2,}/g, " ")
                        .trim()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setReviewing(false); setUnchecked(new Set()); }}
            >
              Back
            </Button>
            <Button size="sm" variant="secondary" disabled={loading} onClick={() => handleAction(() => onIngestOnly(item.id))}>
              Dismiss
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={loading || selectedCount === 0}
              onClick={() => handleAction(() => {
                const excluded = unchecked.size > 0 ? Array.from(unchecked) : undefined;
                return onApprove(item.id, excluded);
              })}
            >
              {loading ? "Applying..." : `Apply Selected Changes (${selectedCount})`}
            </Button>
          </div>
        </div>
      );
    }

    // Compact summary view (default)
    return (
      <div style={{ border: "1px solid #e8e6df", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafaf7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: "#b08000", fontSize: 14 }}>&#9888;</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f", flex: 1 }}>
            Database Changes: &ldquo;{entityName}&rdquo;
          </span>
        </div>
        {item.ai_summary ? (
          <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12, lineHeight: 1.5 }}>
            {item.ai_summary}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
            AI extracted data that would update this entity.
          </div>
        )}
        <div style={{ background: "white", border: "1px solid #e8e6df", borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#1a1a1f", fontWeight: 500, marginBottom: 6 }}>
            {docName} ({docTypeLabel}{item.ai_year ? `, ${item.ai_year}` : ""})
          </div>
          <div style={{ fontSize: 12, color: "#6b6b76" }}>
            {actions.map((a, i) => (
              <div key={i} style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                <span>&#8226;</span>
                <span>{formatAction(a)}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="sm"
            variant="primary"
            disabled={loading}
            onClick={() => handleAction(() => onApprove(item.id))}
          >
            {loading ? "Applying..." : "Approve Changes"}
          </Button>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => handleAction(() => onIngestOnly(item.id))}>
            Ingest Only
          </Button>
          {actions.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setReviewing(true)}
            >
              Review Changes
            </Button>
          )}
        </div>
      </div>
    );
  }

  // --- Ambiguous / No Match ---
  if (reason === "ambiguous_match" || reason === "no_match") {
    return (
      <div style={{ border: "1px solid #e8e6df", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafaf7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: "#b08000", fontSize: 14 }}>&#9888;</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>
            {reason === "ambiguous_match" ? "Uncertain Match" : "No Entity Found"}: &ldquo;{docName}&rdquo;
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
          {reason === "ambiguous_match"
            ? "AI wasn't confident which entity this document belongs to."
            : "AI couldn't match this document to any entity."}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <select
            value={selectedEntityId}
            onChange={(e) => setSelectedEntityId(e.target.value)}
            style={{
              padding: "6px 10px", border: "1px solid #ddd9d0", borderRadius: 4,
              fontSize: 12, background: "white", fontFamily: "inherit", flex: 1, maxWidth: 300,
            }}
          >
            <option value="">Select an entity...</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            disabled={loading || !selectedEntityId}
            onClick={() => handleAction(() => onAssignEntity(item.id, selectedEntityId))}
          >
            {loading ? "Assigning..." : "Assign & Ingest"}
          </Button>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => handleAction(() => onIngestOnly(item.id))}>
            Ingest as Unassociated
          </Button>
        </div>
      </div>
    );
  }

  // --- New Doc Type ---
  if (reason === "new_doc_type") {
    return (
      <div style={{ border: "1px solid #e8e6df", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafaf7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: "#b08000", fontSize: 14 }}>&#9888;</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>Unknown Doc Type: &ldquo;{docName}&rdquo;</span>
        </div>
        <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
          AI suggested type: <strong>{docTypeLabel}</strong>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="primary" disabled={loading} onClick={() => handleAction(() => onApprove(item.id))}>
            {loading ? "Ingesting..." : "Use Suggested Type"}
          </Button>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => handleAction(() => onIngestOnly(item.id))}>
            Ingest Only
          </Button>
        </div>
      </div>
    );
  }

  // Fallback
  return (
    <div style={{ border: "1px solid #e8e6df", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafaf7" }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: "#1a1a1f", marginBottom: 8 }}>
        {docName} ({docTypeLabel})
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="sm" variant="primary" disabled={loading} onClick={() => handleAction(() => onApprove(item.id))}>
          {loading ? "Approving..." : "Approve"}
        </Button>
        <Button size="sm" variant="secondary" disabled={loading} onClick={() => handleAction(() => onIngestOnly(item.id))}>
          Ingest Only
        </Button>
      </div>
    </div>
  );
}
