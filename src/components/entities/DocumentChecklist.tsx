"use client";

import { useState } from "react";
import { useChatPanel } from "@/components/chat/chat-panel-provider";
import { DOCUMENT_TYPE_LABELS, DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import type { DocumentCategory } from "@/lib/types/entities";

export interface ChecklistExpectation {
  id: string;
  document_type: string;
  document_category: string;
  is_required: boolean;
  is_satisfied: boolean;
  is_not_applicable: boolean;
  is_suggestion: boolean;
  source: string;
  notes: string | null;
  satisfied_by: string | null;
  satisfied_doc: {
    id: string;
    name: string;
    document_type: string;
    year: number | null;
    created_at: string;
  } | null;
  confidence: number | null;
  inference_reason: string | null;
}

function docTypeLabel(slug: string): string {
  return (
    DOCUMENT_TYPE_LABELS[slug] ||
    slug.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
  );
}

export function DocumentChecklist({
  entityName,
  expectations,
  onConfirmSuggestion,
  onDismissSuggestion,
  onMarkNA,
  onMarkNeeded,
  onSelectDoc,
}: {
  entityName: string;
  expectations: ChecklistExpectation[];
  onConfirmSuggestion: (id: string) => void | Promise<void>;
  onDismissSuggestion: (id: string) => void | Promise<void>;
  onMarkNA: (id: string) => void | Promise<void>;
  onMarkNeeded: (id: string) => void | Promise<void>;
  /** Optional — called when the user clicks a satisfied item's filename.
   *  Lets the parent scroll to the doc in its list. */
  onSelectDoc?: (documentId: string) => void;
}) {
  const { open: openChat } = useChatPanel();
  const [showNA, setShowNA] = useState(false);

  // Partition expectations.
  const satisfied = expectations.filter((e) => e.is_satisfied && !e.is_not_applicable);
  const missingRequired = expectations.filter(
    (e) => !e.is_satisfied && !e.is_suggestion && !e.is_not_applicable && e.is_required,
  );
  const missingOptional = expectations.filter(
    (e) => !e.is_satisfied && !e.is_suggestion && !e.is_not_applicable && !e.is_required,
  );
  const suggestions = expectations.filter((e) => e.is_suggestion && !e.is_not_applicable);
  const notApplicable = expectations.filter((e) => e.is_not_applicable && !e.is_suggestion);

  const total = satisfied.length + missingRequired.length + missingOptional.length;

  // Nothing to show — skip the whole card.
  if (total === 0 && suggestions.length === 0 && notApplicable.length === 0) {
    return null;
  }

  const requestUpload = (exp: ChecklistExpectation) => {
    const label = docTypeLabel(exp.document_type);
    openChat(`Upload ${label} for ${entityName}`);
  };

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e8e6df",
        borderRadius: 10,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", margin: 0 }}>
          Document Checklist
        </h2>
        {total > 0 && (
          <span style={{ fontSize: 12, color: "#6b6b76" }}>
            {satisfied.length}/{total} complete
          </span>
        )}
      </div>

      {satisfied.length > 0 && (
        <Group>
          {satisfied.map((exp) => (
            <Row
              key={exp.id}
              icon={<SatisfiedIcon />}
              primary={docTypeLabel(exp.document_type)}
              secondary={
                exp.satisfied_doc?.name && exp.satisfied_doc.name !== docTypeLabel(exp.document_type)
                  ? exp.satisfied_doc.name
                  : undefined
              }
              onPrimaryClick={
                exp.satisfied_doc?.id && onSelectDoc
                  ? () => onSelectDoc(exp.satisfied_doc!.id)
                  : undefined
              }
              badge={categoryBadge(exp.document_category)}
              color="#2d5a3d"
            />
          ))}
        </Group>
      )}

      {missingRequired.length > 0 && (
        <Group label={`Missing (${missingRequired.length})`} labelColor="#c47520">
          {missingRequired.map((exp) => (
            <Row
              key={exp.id}
              icon={<MissingIcon color="#c47520" />}
              primary={docTypeLabel(exp.document_type)}
              badge={categoryBadge(exp.document_category)}
              extraBadge={requiredBadge(true)}
              actions={
                <>
                  <ActionButton onClick={() => requestUpload(exp)} primary>
                    Upload
                  </ActionButton>
                  <LinkButton onClick={() => onMarkNA(exp.id)} title="Mark as not applicable">
                    N/A
                  </LinkButton>
                </>
              }
            />
          ))}
        </Group>
      )}

      {missingOptional.length > 0 && (
        <Group label={`Optional (${missingOptional.length})`}>
          {missingOptional.map((exp) => (
            <Row
              key={exp.id}
              icon={<MissingIcon color="#9494a0" />}
              primary={docTypeLabel(exp.document_type)}
              badge={categoryBadge(exp.document_category)}
              extraBadge={requiredBadge(false)}
              actions={
                <>
                  <ActionButton onClick={() => requestUpload(exp)}>Upload</ActionButton>
                  <LinkButton onClick={() => onMarkNA(exp.id)} title="Mark as not applicable">
                    N/A
                  </LinkButton>
                </>
              }
            />
          ))}
        </Group>
      )}

      {suggestions.length > 0 && (
        <Group label={`Suggestions (${suggestions.length})`} labelColor="#8b6914">
          {suggestions.map((exp) => (
            <Row
              key={exp.id}
              icon={<SuggestionIcon />}
              primary={docTypeLabel(exp.document_type)}
              secondary={exp.inference_reason || undefined}
              secondaryColor="#8b6914"
              badge={categoryBadge(exp.document_category)}
              tint="rgba(139,105,20,0.03)"
              actions={
                <>
                  <ActionButton onClick={() => onConfirmSuggestion(exp.id)} primary>
                    Accept
                  </ActionButton>
                  <LinkButton onClick={() => onDismissSuggestion(exp.id)}>Dismiss</LinkButton>
                </>
              }
            />
          ))}
        </Group>
      )}

      {notApplicable.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid #f0eee8", paddingTop: 10 }}>
          <button
            onClick={() => setShowNA((v) => !v)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              color: "#9494a0",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              padding: 0,
            }}
          >
            {showNA ? "▾" : "▸"} Not Applicable ({notApplicable.length})
          </button>
          {showNA &&
            notApplicable.map((exp) => (
              <div
                key={exp.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 0",
                  fontSize: 13,
                  opacity: 0.6,
                }}
              >
                <span style={{ color: "#9494a0", fontSize: 14, flexShrink: 0 }}>—</span>
                <span
                  style={{
                    flex: 1,
                    color: "#9494a0",
                    textDecoration: "line-through",
                  }}
                >
                  {docTypeLabel(exp.document_type)}
                </span>
                <LinkButton onClick={() => onMarkNeeded(exp.id)}>Mark as needed</LinkButton>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Internal row + helpers
// ─────────────────────────────────────────────────────────────

function Group({
  label,
  labelColor = "#6b6b76",
  children,
}: {
  label?: string;
  labelColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: labelColor,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: 4,
          }}
        >
          {label}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

function Row({
  icon,
  primary,
  secondary,
  secondaryColor = "#9494a0",
  badge,
  extraBadge,
  actions,
  tint,
  color,
  onPrimaryClick,
}: {
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
  secondaryColor?: string;
  badge?: React.ReactNode;
  extraBadge?: React.ReactNode;
  actions?: React.ReactNode;
  tint?: string;
  color?: string;
  onPrimaryClick?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid #f8f7f4",
        fontSize: 13,
        background: tint,
      }}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {onPrimaryClick ? (
          <button
            onClick={onPrimaryClick}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 500,
              color: color || "#1a1a1f",
              textAlign: "left",
            }}
          >
            {primary}
          </button>
        ) : (
          <span style={{ fontWeight: 500, color: color || "#1a1a1f" }}>{primary}</span>
        )}
        {secondary && (
          <div style={{ fontSize: 11, color: secondaryColor, marginTop: 2 }}>{secondary}</div>
        )}
      </div>
      {badge}
      {extraBadge}
      {actions}
    </div>
  );
}

function categoryBadge(category: string) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "1px 6px",
        borderRadius: 4,
        color: "#6b6b76",
        background: "rgba(107,107,118,0.08)",
      }}
    >
      {DOCUMENT_CATEGORY_LABELS[category as DocumentCategory] || category}
    </span>
  );
}

function requiredBadge(required: boolean) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: required ? "#c47520" : "#9494a0",
        background: required ? "rgba(196,117,32,0.08)" : "rgba(0,0,0,0.04)",
        padding: "2px 8px",
        borderRadius: 4,
      }}
    >
      {required ? "Required" : "Optional"}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: primary ? "#2d5a3d" : "rgba(45,90,61,0.08)",
        border: "none",
        fontSize: 11,
        fontWeight: 600,
        color: primary ? "#fff" : "#2d5a3d",
        cursor: "pointer",
        padding: "4px 10px",
        borderRadius: 4,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function LinkButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: "none",
        fontSize: 11,
        color: "#9494a0",
        cursor: "pointer",
        padding: "2px 6px",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function SatisfiedIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#2d5a3d" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function MissingIcon({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        width: 14,
        height: 14,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: `1.5px solid ${color}`,
      }}
    />
  );
}

function SuggestionIcon() {
  return <span style={{ color: "#8b6914", fontSize: 14 }}>✦</span>;
}
