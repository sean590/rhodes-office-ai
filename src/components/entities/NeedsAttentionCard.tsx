"use client";

/**
 * EntityStateBanner + NeedsAttentionCard — the "lead with state, not schema"
 * surface for the entity Overview (UX refresh North Star #2). Instead of opening
 * EIN-first, the page opens with a plain-language line about what this entity is
 * and whether anything needs attention, then a card that lists the open/overdue
 * filings and missing required documents (replacing the Document-Completeness
 * panel; the full checklist lives on the Documents tab).
 */

import React from "react";
import { Icon } from "@/components/ui/icon";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { formatDue } from "@/lib/format-time";

export interface NeedsFiling {
  id: string;
  name: string;
  next_due_date: string | null;
  status: string;
}
export interface MissingDoc {
  document_type: string;
  document_category: string;
}

export function EntityStateBanner({
  name, typeLabel, status, formationState, formedYear, overdueFilings, openFilings, missingDocs, showAttention = true,
}: {
  name: string;
  typeLabel: string;
  status: string;
  formationState: string | null;
  formedYear: number | null;
  overdueFilings: number;
  openFilings: number;
  missingDocs: number;
  showAttention?: boolean;
}) {
  const statusWord = status.replace(/_/g, " ");
  const where = [formedYear ? `formed ${formedYear}` : null, formationState ? `in ${formationState}` : null].filter(Boolean).join(" ");
  const lead = `${name} is ${statusWord}${typeLabel ? ` — a ${typeLabel}` : ""}${where ? `, ${where}` : ""}.`;

  const attentionTotal = overdueFilings + (openFilings - overdueFilings) + missingDocs;
  const bits: { text: string; color: string }[] = [];
  if (overdueFilings > 0) bits.push({ text: `${overdueFilings} filing${overdueFilings === 1 ? "" : "s"} overdue`, color: "var(--red)" });
  const dueSoon = openFilings - overdueFilings;
  if (dueSoon > 0) bits.push({ text: `${dueSoon} filing${dueSoon === 1 ? "" : "s"} coming up`, color: "var(--amber)" });
  if (missingDocs > 0) bits.push({ text: `${missingDocs} document${missingDocs === 1 ? "" : "s"} missing`, color: "var(--amber)" });

  return (
    <div style={{ marginBottom: 20, padding: "14px 18px", border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: 999, background: statusWord === "active" ? "var(--green)" : "var(--muted)" }} />
        <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>{lead}</span>
      </div>
      {showAttention && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingLeft: 18, flexWrap: "wrap" }}>
        {attentionTotal === 0 ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--green)" }}>
            <Icon name="circle-check" size={15} /> Everything&rsquo;s up to date.
          </span>
        ) : (
          bits.map((b, i) => (
            <React.Fragment key={b.text}>
              {i > 0 && <span style={{ color: "var(--faint)" }}>·</span>}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: b.color }}>
                <Icon name="alert-triangle" size={14} /> {b.text}
              </span>
            </React.Fragment>
          ))
        )}
      </div>
      )}
    </div>
  );
}

// Soft inset divider — much lighter than var(--line), and offset past the icon
// so the rows read as a tidy list rather than a stack of heavy rules.
function AttnRow({ icon, color, title, badge, badgeColor, onClick, first }: {
  icon: React.ReactNode; color: string; title: string; badge?: string; badgeColor?: string; onClick: () => void; first?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10,
        padding: "9px 0", background: "none", border: "none",
        borderTop: first ? "none" : "1px solid rgba(31,36,32,0.06)",
        cursor: "pointer", fontFamily: "inherit", color: "var(--faint)",
      }}
    >
      <span style={{ flexShrink: 0, color, display: "inline-flex" }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      {badge && <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 600, color: badgeColor ?? "var(--muted)" }}>{badge}</span>}
      <Icon name="chevron-right" size={15} />
    </button>
  );
}

function docLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type] || type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function NeedsAttentionCard({
  filings, missingDocs, onNavigateFilings, onNavigateDocs,
}: {
  filings: NeedsFiling[];
  missingDocs: MissingDoc[];
  onNavigateFilings: () => void;
  onNavigateDocs: () => void;
}) {
  const total = filings.length + missingDocs.length;
  const sortedFilings = [...filings].sort((a, b) => (a.next_due_date ?? "9999") < (b.next_due_date ?? "9999") ? -1 : 1);

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--card)", padding: "16px 18px", alignSelf: "start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: total === 0 ? 0 : 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Needs attention</span>
        {total > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, minWidth: 18, textAlign: "center", padding: "1px 6px", borderRadius: 999, background: "var(--line)", color: "var(--muted)" }}>{total}</span>
        )}
      </div>

      {total === 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 0 4px", color: "var(--muted)", fontSize: 13 }}>
          <Icon name="circle-check" size={18} color="var(--green)" /> No open filings or missing documents.
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {sortedFilings.map((f, i) => {
            const due = f.next_due_date ? formatDue(f.next_due_date) : null;
            return (
              <AttnRow
                key={f.id}
                first={i === 0}
                icon={<Icon name="checklist" size={17} />}
                color={due?.overdue ? "var(--red)" : "var(--amber)"}
                title={f.name}
                badge={due?.text}
                badgeColor={due?.overdue ? "var(--red)" : "var(--amber)"}
                onClick={onNavigateFilings}
              />
            );
          })}
          {missingDocs.map((d, i) => (
            <AttnRow
              key={`${d.document_type}-${d.document_category}`}
              first={i === 0 && sortedFilings.length === 0}
              icon={<Icon name="file-text" size={17} />}
              color="var(--blue)"
              title={docLabel(d.document_type)}
              badge="missing"
              onClick={onNavigateDocs}
            />
          ))}
        </div>
      )}
    </div>
  );
}
