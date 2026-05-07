"use client";

/**
 * Unified review card. Replaces ApprovalCard for queue items processed by
 * the document agent (i.e., items with `chat_session_id` set). The agent
 * has already applied confident link/update writes; this card surfaces the
 * agent's defer reason + lets the user fix the few things it couldn't pin
 * down (entity / investment / transaction) and file the queue item.
 *
 * Submission goes through `/api/chat/apply-actions` — the same endpoint
 * chat uses. Each picker change becomes an action; a `file_queue_item`
 * action is appended to flip the queue item to "approved" in the same
 * transaction. One approval mechanic across surfaces.
 *
 * Legacy items (with `ai_proposed_actions` populated and no `chat_session_id`)
 * still render through `ApprovalCard` for now — the dispatch happens in
 * /review's parent rendering. ApprovalCard goes away in phase 6.
 */

import { useState, useEffect, useMemo } from "react";
import {
  StagedActionsList,
  type StagedAction as DisplayAction,
} from "@/components/shared/StagedActionsList";

// --- Types -----------------------------------------------------------------

export interface ReviewQueueItem {
  id: string;
  document_id: string | null;
  chat_session_id: string;
  ai_summary: string | null;
  ai_entity_id: string | null;
  ai_document_type: string | null;
  ai_document_category: string | null;
  ai_year: number | null;
  original_filename: string;
}

export interface ReviewDocument {
  id: string;
  investment_id: string | null;
  name: string | null;
  document_type: string | null;
}

export interface ReviewEntity {
  id: string;
  name: string;
}

interface InvestmentLite {
  id: string;
  name: string;
}

interface TransactionLite {
  id: string;
  transaction_type: string;
  transaction_date: string;
  amount: number;
  document_id: string | null;
  investment_investor_id: string | null;
  investor_entity_name?: string | null;
}

interface Props {
  item: ReviewQueueItem;
  entities: ReviewEntity[];
  /** Fired after a successful submit — parent should refetch the queue. */
  onSubmitted: () => void;
  /** Fired when the user clicks "Open in chat". Parent decides how to surface
   *  the chat (drawer / route push). When omitted, button is hidden. */
  onOpenChat?: (sessionId: string) => void;
}

// --- Helpers ---------------------------------------------------------------

function fmtDollars(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Stable-enough id for a one-shot action submitted from this card. The
 *  apply-actions endpoint doesn't persist these between sessions, so a
 *  per-render uuid is fine. */
function newActionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Component -------------------------------------------------------------

export function ReviewCard({
  item,
  entities,
  onSubmitted,
  onOpenChat,
}: Props) {
  const [doc, setDoc] = useState<ReviewDocument | null>(null);
  const initialEntityId = item.ai_entity_id ?? "";
  const initialInvestmentId = doc?.investment_id ?? "";

  const [entityId, setEntityId] = useState(initialEntityId);
  const [investmentId, setInvestmentId] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [investments, setInvestments] = useState<InvestmentLite[]>([]);
  const [transactions, setTransactions] = useState<TransactionLite[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load the document so the parent doesn't have to wire it. Sets
  // initial investment from the doc once it lands.
  useEffect(() => {
    if (!item.document_id) {
      setDoc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${item.document_id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const docInfo: ReviewDocument = {
          id: data.id,
          investment_id: data.investment_id ?? null,
          name: data.name ?? null,
          document_type: data.document_type ?? null,
        };
        setDoc(docInfo);
        if (docInfo.investment_id && !investmentId) {
          setInvestmentId(docInfo.investment_id);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally don't depend on investmentId — the inner check
    // prevents overwriting a user-driven picker change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.document_id]);

  // Initial transaction selection: if any transaction in the picker list
  // already has document_id matching ours, default to it. Set after the
  // transactions load.
  useEffect(() => {
    if (!doc?.id || transactions.length === 0) return;
    if (transactionId) return;
    const existing = transactions.find((t) => t.document_id === doc.id);
    if (existing) setTransactionId(existing.id);
  }, [transactions, doc?.id, transactionId]);

  // Load investments scoped to the selected entity. When the entity is
  // empty, clear the list so the investment picker doesn't show stale rows.
  useEffect(() => {
    if (!entityId) {
      setInvestments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/investments?entity_id=${entityId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setInvestments(
            data.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name })),
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  // Load transactions for the selected investment.
  useEffect(() => {
    if (!investmentId) {
      setTransactions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/investments/${investmentId}/transactions`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setTransactions(data);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [investmentId]);

  // Compute pending actions live as the user edits the pickers. Rendered
  // through StagedActionsList so the unification surface is the same as
  // chat — same component, same data shape.
  const pendingActions = useMemo(() => {
    const out: Array<DisplayAction & { tool: string; input: Record<string, unknown> }> = [];
    if (!doc) return out;

    if (entityId && entityId !== initialEntityId) {
      const ent = entities.find((e) => e.id === entityId);
      out.push({
        id: `link-entity-${entityId}`,
        tool: "link_document_to_entity",
        input: { document_id: doc.id, entity_id: entityId },
        summary: `Link to ${ent?.name ?? "entity"}`,
      });
    }
    if (investmentId && investmentId !== initialInvestmentId) {
      const inv = investments.find((i) => i.id === investmentId);
      out.push({
        id: `link-investment-${investmentId}`,
        tool: "link_document_to_investment",
        input: { document_id: doc.id, investment_id: investmentId },
        summary: `Link to ${inv?.name ?? "investment"}`,
      });
    }
    if (transactionId) {
      const txn = transactions.find((t) => t.id === transactionId);
      // Only stage if this txn doesn't already point at this document.
      if (txn && txn.document_id !== doc.id) {
        out.push({
          id: `attach-txn-${transactionId}`,
          tool: "update_investment_transaction",
          input: { transaction_id: transactionId, document_id: doc.id },
          summary: `Attach to ${txn.transaction_type} of ${fmtDollars(Number(txn.amount))} on ${fmtDate(txn.transaction_date)}`,
        });
      }
    }

    // Always append the file action so Save flips the queue item out of
    // /review. Last in the list — applied after the link writes.
    out.push({
      id: `file-${item.id}`,
      tool: "file_queue_item",
      input: { queue_item_id: item.id },
      summary: "File document — mark approved",
    });

    return out;
  }, [
    doc,
    entityId,
    investmentId,
    transactionId,
    investments,
    transactions,
    entities,
    initialEntityId,
    initialInvestmentId,
    item.id,
  ]);

  const handleSubmit = async () => {
    if (!item.chat_session_id || pendingActions.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const stagedShape = pendingActions.map((a) => ({
        id: newActionId(),
        tool: a.tool,
        input: a.input,
        summary: a.summary,
      }));
      const res = await fetch("/api/chat/apply-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: item.chat_session_id,
          actions: stagedShape,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to apply actions");
        return;
      }
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply actions");
    } finally {
      setSubmitting(false);
    }
  };

  // What the agent already did — read from documents row for entity/investment
  // and from transactions for the txn link. Defensive: doc may be null if
  // the queue item lost its document_id reference somehow.
  const filedEntityName =
    entities.find((e) => e.id === item.ai_entity_id)?.name ?? null;
  const initialInvName = useMemo(() => {
    if (!initialInvestmentId) return null;
    const inv = investments.find((i) => i.id === initialInvestmentId);
    return inv?.name ?? null;
  }, [initialInvestmentId, investments]);

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e8e6df",
        borderRadius: 10,
        padding: 16,
        marginBottom: 12,
      }}
    >
      {/* Defer banner — what the agent couldn't pin down. */}
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          background: "#fef6e4",
          border: "1px solid #f4d99a",
          color: "#7a5a18",
          borderRadius: 8,
          padding: "10px 12px",
          marginBottom: 14,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 2, color: "#5a3d00" }}>
            {item.original_filename}
          </div>
          <div>{item.ai_summary || "Agent stopped before filing — see below."}</div>
        </div>
      </div>

      {/* "What we know" — the agent's confident outputs. */}
      <div
        style={{
          fontSize: 12,
          color: "#6b6b76",
          marginBottom: 14,
          lineHeight: 1.7,
        }}
      >
        <div style={{ fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: 0.5, fontSize: 11, marginBottom: 4 }}>
          What the agent did
        </div>
        <div>
          {item.ai_document_type ? "✓" : "—"} Document type:{" "}
          <span style={{ color: "#1a1a1f" }}>
            {item.ai_document_type
              ? `${item.ai_document_type.replace(/_/g, " ")}${item.ai_year ? ` (${item.ai_year})` : ""}`
              : "not identified"}
          </span>
        </div>
        <div>
          {filedEntityName ? "✓" : "—"} Entity:{" "}
          <span style={{ color: "#1a1a1f" }}>{filedEntityName ?? "not assigned"}</span>
        </div>
        <div>
          {initialInvName ? "✓" : "—"} Investment:{" "}
          <span style={{ color: "#1a1a1f" }}>
            {initialInvName ?? (initialInvestmentId ? "(loading…)" : "not assigned")}
          </span>
        </div>
        <div>— Transaction: not attached</div>
      </div>

      {/* Pickers — fix and file. */}
      <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: 0.5, fontSize: 11 }}>
          Fix and file
        </div>

        <PickerRow
          label="Entity"
          value={entityId}
          onChange={(v) => {
            setEntityId(v);
            setInvestmentId("");
            setTransactionId("");
          }}
          options={entities.map((e) => ({ value: e.id, label: e.name }))}
          placeholder="No entity"
        />

        <PickerRow
          label="Investment"
          value={investmentId}
          onChange={(v) => {
            setInvestmentId(v);
            setTransactionId("");
          }}
          options={investments.map((i) => ({ value: i.id, label: i.name }))}
          placeholder={entityId ? "No investment" : "Pick an entity first"}
          disabled={!entityId}
        />

        <PickerRow
          label="Transaction"
          value={transactionId}
          onChange={setTransactionId}
          options={transactions.map((t) => ({
            value: t.id,
            label: `${t.transaction_type === "distribution" ? "Distribution" : t.transaction_type === "contribution" ? "Contribution" : "Return of capital"} · ${fmtDollars(Number(t.amount))} · ${fmtDate(t.transaction_date)}${t.investor_entity_name ? ` · ${t.investor_entity_name}` : ""}${t.document_id && t.document_id !== doc?.id ? " · already attached" : ""}`,
          }))}
          placeholder={investmentId ? "Don't attach to a transaction" : "Pick an investment first"}
          disabled={!investmentId}
        />
      </div>

      {/* Live preview of the actions that Save will apply — same primitive
          chat uses. Note: pickers above feed pendingActions; if everything
          is at default state, this collapses to just file_queue_item. */}
      {pendingActions.length > 1 && (
        <div style={{ marginBottom: 14 }}>
          <StagedActionsList
            actions={pendingActions.map((a) => ({
              id: a.id,
              tool: a.tool,
              summary: a.summary,
              status: undefined,
            }))}
            checkedIds={new Set(pendingActions.map((a) => a.id))}
            onToggle={() => {
              /* picker-driven actions are not toggleable — change the
                 picker itself to remove an action. */
            }}
            disabled
            heading="Will be applied on save"
          />
        </div>
      )}

      {error && (
        <div
          style={{
            background: "#fbe8e8",
            border: "1px solid #f4b8b8",
            color: "#7a1818",
            borderRadius: 6,
            padding: "8px 10px",
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={submitting || pendingActions.length === 0}
          style={{
            flex: 1,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            background:
              !submitting && pendingActions.length > 0 ? "#2d5a3d" : "#ddd9d0",
            color: !submitting && pendingActions.length > 0 ? "#fff" : "#9494a0",
            border: "none",
            borderRadius: 6,
            cursor:
              !submitting && pendingActions.length > 0 ? "pointer" : "not-allowed",
            fontFamily: "inherit",
          }}
        >
          {submitting ? "Saving…" : "Save and file"}
        </button>
        {onOpenChat && (
          <button
            onClick={() => onOpenChat(item.chat_session_id)}
            disabled={submitting}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              background: "white",
              color: "#3366a8",
              border: "1px solid #d0d0d8",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Open in chat
          </button>
        )}
      </div>
    </div>
  );
}

// --- Picker subcomponent ---------------------------------------------------

interface PickerRowProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  disabled?: boolean;
}

function PickerRow({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
}: PickerRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 100,
          fontSize: 12,
          color: "#6b6b76",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          flex: 1,
          padding: "6px 10px",
          fontSize: 13,
          border: "1px solid #ddd9d0",
          borderRadius: 6,
          background: disabled ? "#f8f7f4" : "white",
          color: disabled ? "#9494a0" : "#1a1a1f",
          fontFamily: "inherit",
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
