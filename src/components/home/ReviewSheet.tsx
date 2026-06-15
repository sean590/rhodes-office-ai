"use client";

/**
 * ReviewSheet — the step-through + edit surface for an origin group (spec §5).
 * Two-level nesting cap: reviewing/editing a group item-by-item happens here, in
 * a ~440px right panel, never by navigating away. Staged actions render as an
 * EDITABLE form (the action's own parameters as typed fields); edits are applied
 * through the same /api/chat/apply-actions path (which re-validates input, so a
 * changed field just works). Footer mirrors the prototype: Dismiss / Skip /
 * prev-next / Approve & next.
 */

import React, { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

export type SheetFieldType =
  | "text" | "number" | "money" | "date" | "year" | "enum" | "entity" | "investment" | "document" | "readonly";

export interface SheetField {
  key: string;
  label: string;
  type: SheetFieldType;
  enumValues?: string[];
}

export interface SheetOption { id: string; name: string }

export interface SheetEntry {
  id: string;
  title: string;
  subtitle?: string;
  dup?: string;
  /** Editable parameters (staged actions). When absent, `detail` is shown read-only. */
  fields?: SheetField[];
  input?: Record<string, unknown>;
  detail?: React.ReactNode;
  primaryLabel: string;
  /** Apply this item. `editedInput` is the merged form values (staged actions); undefined for read-only items. */
  onApprove: (editedInput?: Record<string, unknown>) => void;
  onDismiss?: () => void;
  reassignHref?: string;
  onRefineChat?: () => void;
  busy?: boolean;
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", fontSize: 13.5, fontFamily: "inherit",
  padding: "8px 10px", border: "1px solid var(--line-2)", borderRadius: 8,
  background: "var(--card)", color: "var(--ink)",
};
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 5, display: "block" };
const fullSpan: React.CSSProperties = { gridColumn: "1 / -1" };

function isShort(t: SheetFieldType) {
  return t === "money" || t === "date" || t === "year" || t === "number" || t === "enum";
}

function nameFor(opts: SheetOption[], id: string): string | null {
  return opts.find((o) => o.id === id)?.name ?? null;
}

function Field({
  field, value, onChange, entityOptions, investmentOptions, documentOptions,
}: {
  field: SheetField;
  value: unknown;
  onChange: (v: unknown) => void;
  entityOptions: SheetOption[];
  investmentOptions: SheetOption[];
  documentOptions: SheetOption[];
}) {
  const wrap = (control: React.ReactNode) => (
    <div style={isShort(field.type) ? undefined : fullSpan}>
      <label style={labelStyle}>{field.label}</label>
      {control}
    </div>
  );
  const str = value == null ? "" : String(value);

  switch (field.type) {
    case "readonly":
      return wrap(<div style={{ ...inputStyle, background: "var(--page)", color: "var(--muted)" }}>{str || "—"}</div>);
    case "document":
      // Reference to the underlying document — shown resolved, never as a UUID.
      return wrap(<div style={{ ...inputStyle, background: "var(--page)", color: "var(--muted)" }}>{(str && nameFor(documentOptions, str)) || (str ? "(document)" : "—")}</div>);
    case "money":
      // Hold the raw typed string (so "." / decimals survive); coerce to a
      // number only at approve time. Storing the parsed number here would
      // re-render the controlled value and strip a trailing ".".
      return wrap(
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 10, top: 9, fontSize: 13.5, color: "var(--faint)" }}>$</span>
          <input style={{ ...inputStyle, paddingLeft: 20 }} inputMode="decimal" value={str}
            onChange={(e) => onChange(e.target.value)} />
        </div>,
      );
    case "number":
    case "year":
      return wrap(<input style={inputStyle} inputMode="decimal" value={str} onChange={(e) => onChange(e.target.value)} />);
    case "date":
      return wrap(<input style={inputStyle} type="date" value={str.slice(0, 10)} onChange={(e) => onChange(e.target.value)} />);
    case "enum":
      return wrap(
        <select style={inputStyle} value={str} onChange={(e) => onChange(e.target.value)}>
          {(field.enumValues ?? []).map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
        </select>,
      );
    case "entity":
    case "investment": {
      const opts = field.type === "entity" ? entityOptions : investmentOptions;
      const known = opts.some((o) => o.id === str);
      return wrap(
        <select style={inputStyle} value={str} onChange={(e) => onChange(e.target.value)}>
          {!known && <option value={str}>{str ? "(current selection)" : "— none —"}</option>}
          {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>,
      );
    }
    default:
      return wrap(<input style={inputStyle} value={str} onChange={(e) => onChange(e.target.value)} />);
  }
}

export function ReviewSheet({
  open, onClose, title, entries, initialIndex = 0, entityOptions = [], investmentOptions = [], documentOptions = [],
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  entries: SheetEntry[];
  initialIndex?: number;
  entityOptions?: SheetOption[];
  investmentOptions?: SheetOption[];
  documentOptions?: SheetOption[];
}) {
  const [index, setIndex] = useState(initialIndex);
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  if (!open) return null;

  // Approving or dismissing an item removes it from `entries` upstream (the
  // parent prunes it), which slides the next item into the current index — so
  // those actions must NOT also advance, or they'd skip the following item.
  // The ‹ › arrows are the only pure-navigation controls.
  const total = entries.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const current = entries[safeIndex];
  const next = () => setIndex(Math.min(safeIndex + 1, Math.max(0, total - 1)));
  const back = () => setIndex(Math.max(0, safeIndex - 1));

  const workingInput = (e: SheetEntry) => ({ ...(e.input ?? {}), ...(edits[e.id] ?? {}) });
  const setField = (entryId: string, key: string, v: unknown) =>
    setEdits((prev) => ({ ...prev, [entryId]: { ...(prev[entryId] ?? {}), [key]: v } }));

  // Coerce the form's string values into the types the tool input expects
  // (money/number/year → number). Empty numeric fields are dropped so we never
  // submit "" where the schema wants a number.
  const coerceInput = (fields: SheetField[], working: Record<string, unknown>) => {
    const out = { ...working };
    for (const f of fields) {
      if (f.type === "money" || f.type === "number" || f.type === "year") {
        const raw = out[f.key];
        if (raw === "" || raw == null) { delete out[f.key]; continue; }
        const n = parseFloat(String(raw).replace(/,/g, ""));
        if (Number.isFinite(n)) out[f.key] = n;
      }
    }
    return out;
  };

  const approveCurrent = () => {
    if (!current) return;
    // No advance() — applying removes this item from `entries` upstream, which
    // slides the next item into the current index for us.
    current.onApprove(current.fields ? coerceInput(current.fields, workingInput(current)) : undefined);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,24,20,0.28)", zIndex: 60 }} />
      <div
        role="dialog" aria-label={title}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 61,
          width: "min(440px, 100vw)", background: "var(--card)",
          borderLeft: "1px solid var(--line)", boxShadow: "-12px 0 40px rgba(20,24,20,0.12)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Review</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          </div>
          {total > 0 && <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{safeIndex + 1} of {total}</span>}
          <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center", border: "1px solid var(--line)", background: "var(--card)", color: "var(--muted)" }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px" }}>
          {total === 0 || !current ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "60px 0", color: "var(--faint)" }}>
              <Icon name="circle-check" size={30} stroke={1.5} />
              <div style={{ fontSize: 14 }}>All caught up in this group.</div>
              <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{current.title}</div>
              {current.subtitle && <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{current.subtitle}</div>}
              {current.dup && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", borderRadius: 8, background: "var(--amber-50)", color: "var(--amber)", fontSize: 12.5, marginTop: 12 }}>
                  <Icon name="alert-triangle" size={14} /> {current.dup}
                </div>
              )}

              {current.fields && current.fields.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
                  {current.fields.map((f) => (
                    <Field
                      key={f.key} field={f} value={workingInput(current)[f.key]}
                      onChange={(v) => setField(current.id, f.key, v)}
                      entityOptions={entityOptions} investmentOptions={investmentOptions} documentOptions={documentOptions}
                    />
                  ))}
                </div>
              ) : (
                current.detail && <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 14 }}>{current.detail}</div>
              )}

              <div style={{ marginTop: 18, display: "flex", gap: 14 }}>
                {current.onRefineChat && (
                  <button onClick={current.onRefineChat} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--green)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                    <Icon name="message" size={15} /> Refine in chat
                  </button>
                )}
                {current.reassignHref && (
                  <Link href={current.reassignHref} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)", textDecoration: "none" }}>
                    <Icon name="external-link" size={15} /> Open in review
                  </Link>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {total > 0 && current && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--line)" }}>
            {current.onDismiss && (
              <button
                onClick={() => current.onDismiss!()}
                disabled={current.busy}
                style={{ fontSize: 13, fontWeight: 600, color: "var(--red)", background: "none", border: "1px solid var(--line)", borderRadius: 8, cursor: current.busy ? "default" : "pointer", fontFamily: "inherit", padding: "7px 14px" }}
              >
                Dismiss
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={back} disabled={safeIndex <= 0} aria-label="Previous" style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", border: "1px solid var(--line)", background: "var(--card)", color: safeIndex <= 0 ? "var(--faint)" : "var(--muted)", cursor: safeIndex <= 0 ? "default" : "pointer" }}>
              <Icon name="arrow-left" size={16} />
            </button>
            <button onClick={next} disabled={safeIndex >= total - 1} aria-label="Next" style={{ width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", border: "1px solid var(--line)", background: "var(--card)", color: safeIndex >= total - 1 ? "var(--faint)" : "var(--muted)", cursor: safeIndex >= total - 1 ? "default" : "pointer" }}>
              <Icon name="arrow-right" size={16} />
            </button>
            <Button variant="primary" onClick={approveCurrent} disabled={current.busy}>
              {current.busy ? "…" : `${current.primaryLabel} & next`}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
