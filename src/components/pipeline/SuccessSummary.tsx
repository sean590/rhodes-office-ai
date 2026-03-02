"use client";

import { useState } from "react";

interface EntityGroup {
  entity_id: string | null;
  entity_name: string;
  documents: Array<{
    id: string;
    document_id: string | null;
    name: string;
    type: string;
    type_label: string;
    year: number | null;
    status: string;
  }>;
}

interface SuccessSummaryProps {
  entitiesAffected: EntityGroup[];
  unassociatedDocuments: EntityGroup["documents"];
}

export function SuccessSummary({ entitiesAffected, unassociatedDocuments }: SuccessSummaryProps) {
  return (
    <div>
      {entitiesAffected.map((group) => (
        <EntityGroupRow key={group.entity_id || "unassociated"} group={group} />
      ))}
      {unassociatedDocuments.length > 0 && (
        <EntityGroupRow
          group={{
            entity_id: null,
            entity_name: "No entity assigned",
            documents: unassociatedDocuments,
          }}
        />
      )}
    </div>
  );
}

function EntityGroupRow({ group }: { group: EntityGroup }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginBottom: 4 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 0",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#9494a0", width: 14 }}>
            {expanded ? "\u25BE" : "\u25B8"}
          </span>
          <span style={{
            fontSize: 13,
            fontWeight: 500,
            color: group.entity_id ? "#1a1a1f" : "#9494a0",
          }}>
            {group.entity_name}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#9494a0" }}>
          {group.documents.length} doc{group.documents.length !== 1 ? "s" : ""}
        </span>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 20, paddingBottom: 4 }}>
          {group.documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                fontSize: 12,
                color: "#6b6b76",
                padding: "3px 0",
              }}
            >
              {doc.type_label}{doc.year ? ` (${doc.year})` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
