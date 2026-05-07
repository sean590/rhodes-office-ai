"use client";

import { useState } from "react";

interface DocRow {
  id: string;
  document_id: string | null;
  name: string;
  type: string;
  type_label: string;
  year: number | null;
  status: string;
  investment_name?: string | null;
  transaction_summary?: string | null;
  is_parent?: boolean;
  child_count?: number;
}

interface EntityGroup {
  entity_id: string | null;
  entity_name: string;
  documents: DocRow[];
}

interface SuccessSummaryProps {
  entitiesAffected: EntityGroup[];
  unassociatedDocuments: DocRow[];
  /** Parent umbrella PDFs (split-doc parents). Rendered separately so the
   *  user sees them as containers, not as misclassified leaves. Optional —
   *  legacy callers without this field still work. */
  parentDocuments?: DocRow[];
}

export function SuccessSummary({
  entitiesAffected,
  unassociatedDocuments,
  parentDocuments = [],
}: SuccessSummaryProps) {
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
      {parentDocuments.length > 0 && (
        <EntityGroupRow
          group={{
            entity_id: null,
            entity_name: "Source PDFs",
            documents: parentDocuments,
          }}
          collapsedByDefault
          subtitle="Original uploads — split into per-investor documents above."
        />
      )}
    </div>
  );
}

function EntityGroupRow({
  group,
  collapsedByDefault = false,
  subtitle,
}: {
  group: EntityGroup;
  collapsedByDefault?: boolean;
  subtitle?: string;
}) {
  const [expanded, setExpanded] = useState(!collapsedByDefault);

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
            {expanded ? "▾" : "▸"}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: group.entity_id ? "#1a1a1f" : "#9494a0",
            }}
          >
            {group.entity_name}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#9494a0" }}>
          {group.documents.length} doc{group.documents.length !== 1 ? "s" : ""}
        </span>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 20, paddingBottom: 4 }}>
          {subtitle && (
            <div
              style={{
                fontSize: 11,
                color: "#9494a0",
                fontStyle: "italic",
                marginBottom: 6,
              }}
            >
              {subtitle}
            </div>
          )}
          {group.documents.map((doc) => (
            <DocRowDisplay key={doc.id} doc={doc} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocRowDisplay({ doc }: { doc: DocRow }) {
  const isParent = doc.is_parent === true;

  return (
    <div
      style={{
        padding: "5px 0",
        fontSize: 12,
        color: "#6b6b76",
        borderTop: "1px solid #f0eee8",
      }}
    >
      <div style={{ color: "#1a1a1f", fontWeight: 500 }}>
        {doc.name}
      </div>
      <div style={{ marginTop: 2, fontSize: 11, color: "#6b6b76" }}>
        {doc.type_label}
        {doc.year ? ` (${doc.year})` : ""}
        {doc.investment_name && (
          <>
            {" · "}
            <span style={{ color: "#3366a8" }}>{doc.investment_name}</span>
          </>
        )}
        {isParent && doc.child_count != null && doc.child_count > 0 && (
          <>
            {" · split into "}
            {doc.child_count} {doc.child_count === 1 ? "child" : "children"}
          </>
        )}
      </div>
      {doc.transaction_summary && (
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: "#2d8a4e",
          }}
        >
          ✓ {doc.transaction_summary}
        </div>
      )}
    </div>
  );
}
