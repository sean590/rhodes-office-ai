"use client";

/**
 * ProcessingRow — one document's processing state, for the Processing surface
 * (and, later, the onboarding progress page). Document + state centric, NOT an
 * approval card: it shows where a document is in the pipeline (queued → reading
 * → filed / needs-review / stuck / locked) and offers retry / cancel / unlock.
 *
 * The actual *approval* of a needs-review item happens in Home → Needs you;
 * here that row just links there. "No batch as a UX concept" — the source is a
 * human chip ("Chat upload", "Uploaded"), never a batch id.
 */

import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { formatStamp } from "@/lib/format-time";
import { friendlyProcessingError } from "@/lib/pipeline/error-copy";

export type ProcessingState =
  | "queued"
  | "reading"
  | "needs_review"
  | "filed"
  | "stuck"
  | "locked";

export interface ProcessingItem {
  id: string;
  document_name: string;
  status: string; // raw QueueStatus
  entity_name: string | null;
  document_type_label: string | null;
  source: string; // human source chip
  created_at: string;
  extraction_error: string | null;
}

/** Map a raw queue status onto the user-facing processing state. */
export function toProcessingState(status: string): ProcessingState {
  switch (status) {
    case "queued":
    case "uploaded":
    case "staged":
      return "queued";
    case "extracting":
    case "extracted":
      return "reading";
    case "review_ready":
      return "needs_review";
    case "approved":
    case "auto_ingested":
      return "filed";
    case "password_required":
      return "locked";
    case "error":
    default:
      return "stuck";
  }
}

const STATE_META: Record<ProcessingState, { label: string; color: string; icon: IconName; spin?: boolean }> = {
  queued: { label: "Queued", color: "var(--muted)", icon: "clock" },
  reading: { label: "Reading", color: "var(--blue)", icon: "refresh", spin: true },
  needs_review: { label: "Needs review", color: "var(--amber)", icon: "eye" },
  filed: { label: "Filed", color: "var(--green)", icon: "circle-check" },
  stuck: { label: "Stuck", color: "var(--red)", icon: "alert-triangle" },
  locked: { label: "Locked", color: "var(--amber)", icon: "shield" },
};

export function ProcessingRow({
  item,
  busy = false,
  onRetry,
  onCancel,
  onUnlock,
  onOpenReview,
}: {
  item: ProcessingItem;
  busy?: boolean;
  onRetry?: (item: ProcessingItem) => void;
  onCancel?: (item: ProcessingItem) => void;
  onUnlock?: (item: ProcessingItem, password: string) => void;
  onOpenReview?: (item: ProcessingItem) => void;
}) {
  const state = toProcessingState(item.status);
  const meta = STATE_META[state];
  const [password, setPassword] = useState("");

  const metaBits = [item.source, item.entity_name, item.document_type_label, formatStamp(item.created_at)]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 4px",
        borderBottom: "1px solid var(--line)",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span style={{ flexShrink: 0, color: meta.color, display: "inline-flex", marginTop: 1 }}>
        <Icon
          name={meta.icon}
          size={17}
          style={meta.spin ? { animation: "spin 1s linear infinite" } : undefined}
        />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.document_name}
        </div>
        {metaBits && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {metaBits}
          </div>
        )}
        {state === "stuck" && (
          <div style={{ fontSize: 12, color: "var(--red)", marginTop: 3, lineHeight: 1.4 }}>
            {friendlyProcessingError(item.extraction_error)}
          </div>
        )}
        {state === "locked" && onUnlock && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (password) onUnlock(item, password); }}
            style={{ display: "flex", gap: 6, marginTop: 8 }}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Document password"
              disabled={busy}
              style={{ fontSize: 12.5, padding: "5px 9px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)", width: 180 }}
            />
            <button
              type="submit"
              disabled={busy || !password}
              style={{ fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink)", cursor: busy || !password ? "default" : "pointer" }}
            >
              Unlock
            </button>
          </form>
        )}
      </div>

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, whiteSpace: "nowrap" }}>{meta.label}</span>

        {state === "needs_review" && onOpenReview && (
          <RowAction label="Open to review" onClick={() => onOpenReview(item)} disabled={busy} />
        )}
        {state === "stuck" && onRetry && (
          <RowAction label="Retry" onClick={() => onRetry(item)} disabled={busy} />
        )}
        {(state === "stuck" || state === "queued" || state === "locked") && onCancel && (
          <RowAction label="Cancel" onClick={() => onCancel(item)} disabled={busy} muted />
        )}
      </div>
    </div>
  );
}

function RowAction({ label, onClick, disabled, muted }: { label: string; onClick: () => void; disabled?: boolean; muted?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12.5,
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--line)",
        background: "var(--card)",
        color: muted ? "var(--muted)" : "var(--ink)",
        cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
