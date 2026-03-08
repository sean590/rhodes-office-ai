"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import type { QueueItem } from "@/lib/types/entities";

interface ApprovalCardProps {
  item: QueueItem;
  entities: Array<{ id: string; name: string }>;
  onApprove: (itemId: string, excludedActionIndices?: number[]) => Promise<void>;
  onIngestOnly: (itemId: string) => Promise<void>;
  onAssignEntity: (itemId: string, entityId: string) => Promise<void>;
}

export function ApprovalCard({ item, entities, onApprove, onIngestOnly, onAssignEntity }: ApprovalCardProps) {
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
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

  // Format actions into human-readable strings
  const formatAction = (action: { action: string; data: Record<string, unknown>; reason?: string }) => {
    switch (action.action) {
      case "add_member":
        return `Add member: ${action.data.name}`;
      case "add_manager":
        return `Add manager: ${action.data.name}`;
      case "add_registration":
        return `Add registration: ${action.data.jurisdiction}${action.data.qualification_date ? ` (${action.data.qualification_date})` : ""}`;
      case "update_registration":
        return `Update registration: last filed ${action.data.last_filing_date || "unknown"}`;
      case "update_entity": {
        const fields = action.data.fields as Record<string, unknown>;
        const changes = Object.entries(fields || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
        return `Update entity: ${changes}`;
      }
      case "update_cap_table":
        return `Update cap table: ${action.data.investor_name} (${action.data.ownership_pct}%)`;
      case "create_relationship":
        return `Create relationship: ${action.data.type} — ${action.data.description || ""}`;
      case "add_trust_role":
        return `Add trust role: ${action.data.role} = ${action.data.name}`;
      case "update_trust_details":
        return `Update trust details`;
      case "complete_obligation":
        return `Complete obligation: filed ${action.data.completed_at || ""}`;
      case "add_partnership_rep":
        return `Add partnership rep: ${action.data.name}`;
      case "add_role":
        return `Add role: ${action.data.role_title} = ${action.data.name}`;
      default:
        return `${action.action}: ${action.reason || ""}`;
    }
  };

  const actions = ((item.ai_proposed_actions || []) as Array<{ action: string; data: Record<string, unknown>; reason?: string }>)
    .filter((a) => a.action !== "create_entity"); // create_entity is handled by "New Entity" card or auto-applied

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

  if (reason === "database_mutations") {
    // Find entity name from the actions
    const entityId = item.ai_entity_id;
    const entity = entities.find((e) => e.id === entityId);
    const entityName = entity?.name || item.staged_entity_name || "Unknown Entity";
    const selectedCount = actions.length - unchecked.size;

    const toggleAction = (index: number) => {
      setUnchecked((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    };

    return (
      <div style={{ border: "1px solid #e8e6df", borderRadius: 8, padding: 16, marginBottom: 12, background: "#fafaf7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ color: "#b08000", fontSize: 14 }}>&#9888;</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1f", flex: 1 }}>
            Database Changes: &ldquo;{entityName}&rdquo;
          </span>
          {actions.length > 1 && (
            <button
              onClick={() => { setEditing(!editing); setUnchecked(new Set()); }}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: 4,
                color: editing ? "#2d5a3d" : "#9494a0", fontSize: 14,
              }}
              title={editing ? "Cancel editing" : "Select individual changes"}
            >
              &#9998;
            </button>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#6b6b76", marginBottom: 12 }}>
          AI extracted data that would update this entity.
        </div>
        <div style={{ background: "white", border: "1px solid #e8e6df", borderRadius: 6, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#1a1a1f", fontWeight: 500, marginBottom: 6 }}>
            {docName} ({docTypeLabel}{item.ai_year ? `, ${item.ai_year}` : ""})
          </div>
          <div style={{ fontSize: 12, color: "#6b6b76" }}>
            {actions.map((a, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: editing && unchecked.has(i) ? 0.4 : 1,
                }}
              >
                {editing ? (
                  <input
                    type="checkbox"
                    checked={!unchecked.has(i)}
                    onChange={() => toggleAction(i)}
                    style={{ margin: 0, cursor: "pointer", accentColor: "#2d5a3d" }}
                  />
                ) : (
                  <span>&#8226;</span>
                )}
                <span>{formatAction(a)}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            size="sm"
            variant="primary"
            disabled={loading || (editing && selectedCount === 0)}
            onClick={() => handleAction(() => {
              const excluded = unchecked.size > 0 ? Array.from(unchecked) : undefined;
              return onApprove(item.id, excluded);
            })}
          >
            {loading ? "Applying..." : editing && unchecked.size > 0 ? `Approve ${selectedCount}/${actions.length} Changes` : "Approve Changes"}
          </Button>
          <Button size="sm" variant="secondary" disabled={loading} onClick={() => handleAction(() => onIngestOnly(item.id))}>
            Ingest Only
          </Button>
        </div>
      </div>
    );
  }

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

  // Fallback for any other reason (e.g. auto_ingest_failed)
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
