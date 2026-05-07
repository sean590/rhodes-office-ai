"use client";

import { useState } from "react";
import type { ChatMessageMetadata } from "@/lib/types/chat";

/**
 * Collapsed "what Claude did" affordance rendered under assistant messages
 * that have an MCP tool-use trace. Click to expand and see the raw tool
 * names, per-call durations, and any errors. Args are intentionally not
 * shown — useful for debug logs, too noisy for the drawer.
 *
 * Default label map translates tool names into plain English. New tools fall
 * back to a humanized version of the name itself so nothing crashes when a
 * future tool lands before this map is updated.
 */

export const TOOL_LABELS: Record<string, string> = {
  list_entities: "Searched entities",
  get_entity: "Looked up an entity",
  get_entity_members: "Looked up members and managers",
  get_cap_table: "Pulled a cap table",
  get_entity_compliance: "Checked compliance obligations",
  get_entity_relationships: "Looked up relationships",
  list_directory_entries: "Searched the directory",
  get_directory_entry: "Looked up a directory entry",
  search_documents: "Searched documents",
  get_document: "Looked up a document",
  list_documents_for_entity: "Listed documents for an entity",
  list_documents_for_investment: "Listed documents for an investment",
  list_investments: "Listed investments",
  get_investment: "Looked up an investment",
  list_investment_transactions: "Pulled transaction history",
  get_investment_allocations: "Looked up investor allocations",
  get_investment_summary: "Computed an investment summary",
  get_investment_investor_summary: "Computed an investor's summary",
  get_entity_investment_summary: "Computed an entity's portfolio summary",
  get_portfolio_summary: "Computed a portfolio summary",
  get_cash_flow_summary: "Computed a cash-flow summary",
  get_entity_summary: "Computed an entity summary",
  get_compliance_summary: "Computed a compliance summary",
  search_audit_log: "Searched activity history",
  get_recent_activity: "Checked recent activity",
};

export function humanizeToolName(name: string): string {
  return TOOL_LABELS[name] || name.replace(/_/g, " ");
}

export function summarizeToolCalls(
  calls: NonNullable<ChatMessageMetadata["tool_calls"]>,
): string {
  if (calls.length === 0) return "No tools used";
  // Deduplicate by label so "Searched entities × 3" renders once, not thrice.
  const counts = new Map<string, number>();
  for (const c of calls) {
    const label = humanizeToolName(c.name);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = Array.from(counts.entries()).map(([label, n]) =>
    n > 1 ? `${label} × ${n}` : label,
  );
  return parts.join(" · ");
}

/**
 * Walk the call list in order; a failed call is "transient" when a later
 * call with the same `name` succeeded. This lets us soften the UI for the
 * common "Claude passed a bad arg, retried with a resolved UUID, moved on"
 * pattern — those shouldn't paint the trace header red or count against the
 * "N failed" badge, since the model self-corrected.
 *
 * Exported for unit testing.
 */
export function classifyCalls(
  calls: NonNullable<ChatMessageMetadata["tool_calls"]>,
): { transientIdxs: Set<number>; terminalIdxs: Set<number> } {
  const transientIdxs = new Set<number>();
  const terminalIdxs = new Set<number>();
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    if (c.ok) continue;
    const recoveredLater = calls
      .slice(i + 1)
      .some((later) => later.name === c.name && later.ok);
    if (recoveredLater) transientIdxs.add(i);
    else terminalIdxs.add(i);
  }
  return { transientIdxs, terminalIdxs };
}

interface ToolCallTraceProps {
  calls: NonNullable<ChatMessageMetadata["tool_calls"]>;
}

export function ToolCallTrace({ calls }: ToolCallTraceProps) {
  const [expanded, setExpanded] = useState(false);
  if (!calls || calls.length === 0) return null;

  const { transientIdxs, terminalIdxs } = classifyCalls(calls);
  // Header alerts only on terminal failures — transient ones self-corrected
  // via a retry and shouldn't scream red at the user.
  const anyTerminalErrors = terminalIdxs.size > 0;
  const terminalCount = terminalIdxs.size;

  return (
    <div
      data-testid="tool-call-trace"
      style={{
        marginTop: 6,
        fontSize: 11,
        color: anyTerminalErrors ? "#a83333" : "#6b6b76",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontSize: 11,
          cursor: "pointer",
          color: "inherit",
          fontFamily: "inherit",
        }}
      >
        <span style={{ opacity: 0.8 }}>{expanded ? "▾" : "▸"}</span>{" "}
        <span>
          {summarizeToolCalls(calls)}
          {anyTerminalErrors ? ` (${terminalCount} failed)` : ""}
        </span>
      </button>

      {expanded && (
        <ul
          style={{
            marginTop: 6,
            padding: 0,
            listStyle: "none",
            borderLeft: "2px solid #e8e6df",
            paddingLeft: 10,
          }}
        >
          {calls.map((c, i) => {
            const isTransient = transientIdxs.has(i);
            const isTerminal = terminalIdxs.has(i);
            return (
              <li key={i} style={{ marginBottom: 2 }}>
                <code style={{ fontSize: 11 }}>{c.name}</code>
                {typeof c.duration_ms === "number" && (
                  <span style={{ opacity: 0.6 }}> · {c.duration_ms}ms</span>
                )}
                {isTerminal && (
                  <span style={{ color: "#a83333" }}>
                    {" · "}
                    {c.error ? c.error : "error"}
                  </span>
                )}
                {isTransient && (
                  <span style={{ opacity: 0.6, fontStyle: "italic" }}>
                    {" · retry succeeded"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
