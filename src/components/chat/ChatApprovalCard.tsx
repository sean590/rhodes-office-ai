"use client";

import { useState, useEffect, useMemo } from "react";
import type { ChatProposedAction, ChatAttachment, ChatMessageMetadata } from "@/lib/types/chat";
import { StagedActionsList } from "@/components/shared/StagedActionsList";
import { ACTION_LABELS, humanizeKey } from "@/lib/chat/action-labels";

// When the orchestrator stages more than this many actions in a single turn,
// the in-chat checkbox list becomes a wall of UI. Above the threshold we
// render a compact summary card and route the user to /review for the full
// list with detail and bulk controls.
const ACTION_THRESHOLD = 8;

interface Props {
  messageId: string;
  sessionId: string;
  metadata: ChatMessageMetadata;
  onActionsApplied: (summary: { applied: number; failed: number; follow_up?: string }) => void;
}

function fmtDollars(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Parse the validator's distribution math-mismatch error string into structured
 * fields so we can render a human-friendly explanation. Format produced by
 * validateInvestmentTransactionLineItems is:
 *   "distribution net (gross 24163.68 - reductions 4878.85 = 19284.83) does not equal amount (19054.29)"
 *
 * Returns null if the error doesn't match this exact pattern (so the caller
 * falls back to the raw error string).
 */
interface DistributionMathError {
  gross: number;
  reductions: number;
  computedNet: number;
  statedNet: number;
  discrepancy: number;
}
function parseDistributionMathError(err: string): DistributionMathError | null {
  const m = err.match(
    /distribution net \(gross ([\d.-]+) - reductions ([\d.-]+) = ([\d.-]+)\) does not equal amount \(([\d.-]+)\)/
  );
  if (!m) return null;
  const gross = Number(m[1]);
  const reductions = Number(m[2]);
  const computedNet = Number(m[3]);
  const statedNet = Number(m[4]);
  if (![gross, reductions, computedNet, statedNet].every(Number.isFinite)) return null;
  return {
    gross,
    reductions,
    computedNet,
    statedNet,
    discrepancy: Math.abs(computedNet - statedNet),
  };
}

/**
 * Same idea for the contribution sum-mismatch error:
 *   "line_items sum (15000.00) does not equal amount (15500.00)"
 */
interface ContributionMathError {
  sum: number;
  amount: number;
  discrepancy: number;
}
function parseContributionMathError(err: string): ContributionMathError | null {
  const m = err.match(/line_items sum \(([\d.-]+)\) does not equal amount \(([\d.-]+)\)/);
  if (!m) return null;
  const sum = Number(m[1]);
  const amount = Number(m[2]);
  if (![sum, amount].every(Number.isFinite)) return null;
  return { sum, amount, discrepancy: Math.abs(sum - amount) };
}

/** Extract key details from action data for display */
function getActionDetails(action: ChatProposedAction): string[] {
  // The AI occasionally proposes actions with no `data` field. Guard so the
  // approval card still renders the action label + description rather than
  // crashing the whole chat drawer.
  const d = (action.data ?? {}) as Record<string, unknown>;
  const details: string[] = [];

  switch (action.action) {
    case "create_entity":
      if (d.name) details.push(`Name: ${d.name}`);
      if (d.type) details.push(`Type: ${String(d.type).replace(/_/g, " ")}`);
      if (d.formation_state) details.push(`State: ${d.formation_state}`);
      break;
    case "create_investment":
      if (d.name) details.push(`Name: ${d.name}`);
      if (d.investment_type || d.type) details.push(`Type: ${String(d.investment_type || d.type).replace(/_/g, " ")}`);
      if (d.parent_entity_id) details.push(`Investor entity: ${d.parent_entity_name || d.parent_entity_id}`);
      break;
    case "create_directory_entry":
      if (d.name) details.push(`Name: ${d.name}`);
      if (d.type) details.push(`Type: ${String(d.type).replace(/_/g, " ")}`);
      break;
    case "record_investment_transaction":
      if (d.parent_entity_id) details.push(`Investor: ${d.parent_entity_name || d.parent_entity_id}`);
      if (d.investment_id && d.investment_name) details.push(`Investment: ${d.investment_name}`);
      if (d.amount) details.push(`Amount: ${fmtDollars(Number(d.amount))}`);
      if (d.transaction_type) details.push(`Type: ${String(d.transaction_type).replace(/_/g, " ")}`);
      if (d.transaction_date) details.push(`Date: ${d.transaction_date}`);
      if (d.description) details.push(`Description: ${d.description}`);
      break;
    case "set_investment_allocations": {
      const allocs = (d.allocations || d.investors) as Array<Record<string, unknown>> | undefined;
      if (allocs && allocs.length > 0) {
        for (const a of allocs) {
          const name = a.member_name || a.entity || a.name || "Unknown";
          const pcts = [
            a.allocation_pct != null ? `${a.allocation_pct}%` : null,
            a.capital_percentage != null ? `${a.capital_percentage}% capital` : null,
            a.profit_percentage != null ? `${a.profit_percentage}% profit` : null,
          ].filter(Boolean).join(", ");
          details.push(`${name}${pcts ? `: ${pcts}` : ""}`);
        }
      }
      break;
    }
    case "update_cap_table":
      if (d.investor_name) details.push(`Investor: ${d.investor_name}`);
      if (d.ownership_pct != null) details.push(`Ownership: ${d.ownership_pct}%`);
      break;
    case "link_document_to_investment":
      if (d.investment_name) details.push(`Investment: ${d.investment_name}`);
      break;
    case "add_member":
    case "add_manager":
      if (d.name) details.push(`Name: ${d.name}`);
      break;
  }
  return details;
}

// Actions that overwrite existing data — never auto-check, always require explicit approval
const REQUIRES_EXPLICIT_APPROVAL = new Set([
  "set_investment_allocations",
  "update_cap_table",
  "update_entity",
]);

export function ChatApprovalCard({ messageId, sessionId, metadata, onActionsApplied }: Props) {
  const actions = metadata.proposed_actions || [];
  const stagedActions = metadata.staged_actions || [];
  const isMcp = stagedActions.length > 0;
  const attachments = metadata.attachments || [];
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => {
    if (isMcp) return new Set(stagedActions.map((a) => a.id));
    return new Set(actions.filter((a) => a.status === "pending" && a.confidence === "high" && !REQUIRES_EXPLICIT_APPROVAL.has(a.action)).map((a) => a.id));
  });
  const [applying, setApplying] = useState(false);
  const [appliedStatuses, setAppliedStatuses] = useState<Record<string, string>>(() => {
    const persisted = metadata.applied_statuses as Record<string, string> | undefined;
    if (persisted && Object.keys(persisted).length > 0) return persisted;
    if (isMcp) return {};
    return Object.fromEntries(actions.filter((a) => a.status !== "pending").map((a) => [a.id, a.status]));
  });
  // Resolve doc names for grouping. Each staged action that touches a
  // document (link_document_to_*, update_document, update_investment_
  // transaction with document_id) gets bucketed by document_id; we hit
  // /api/documents/[id] once per unique id so the group header reads
  // "📄 2024SilverhawkDistribution10.pdf" instead of "Document a8f1…".
  // Falls back to the truncated id while the fetch is in flight.
  const docIdsInStaged = useMemo(() => {
    const ids = new Set<string>();
    for (const a of stagedActions) {
      const id = (a.input as { document_id?: string } | undefined)?.document_id;
      if (id && typeof id === "string") ids.add(id);
    }
    return Array.from(ids);
  }, [stagedActions]);
  const [docNameMap, setDocNameMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (docIdsInStaged.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        docIdsInStaged.map(async (id) => {
          if (docNameMap[id]) return;
          try {
            const res = await fetch(`/api/documents/${id}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data?.name) updates[id] = data.name;
          } catch {
            /* ignore */
          }
        }),
      );
      if (!cancelled && Object.keys(updates).length > 0) {
        setDocNameMap((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIdsInStaged.join("|")]);

  // When pendingItems > ACTION_THRESHOLD, we hide the full checkbox list
  // by default and show a compact summary card. Clicking "Review & Approve"
  // expands the same card in-place — no navigation, since these are
  // chat-message-scoped staged actions, not pipeline queue items, and the
  // /review aggregated page wouldn't show them.
  const [compactExpanded, setCompactExpanded] = useState(false);

  const allItems = isMcp ? stagedActions : actions;
  const allApplied = allItems.every((a) => appliedStatuses[a.id] === "applied" || appliedStatuses[a.id] === "rejected");
  const pendingItems = allItems.filter((a) => !appliedStatuses[a.id] || appliedStatuses[a.id] === "pending");

  if (pendingItems.length > ACTION_THRESHOLD && !compactExpanded) {
    return <CompactActionSummary pending={pendingItems} onExpand={() => setCompactExpanded(true)} />;
  }

  const toggleAction = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    const approved = [...checkedIds];
    if (approved.length === 0) return;
    setApplying(true);

    try {
      let res: Response;
      if (isMcp) {
        // MCP staged actions → send { session_id, actions: [...] } shape.
        const approvedActions = stagedActions.filter((a) => approved.includes(a.id));
        res = await fetch("/api/chat/apply-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            actions: approvedActions,
          }),
        });
      } else {
        // Legacy proposed actions → send { message_id, approved_action_ids } shape.
        res = await fetch("/api/chat/apply-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message_id: messageId,
            approved_action_ids: approved,
          }),
        });
      }

      if (res.ok) {
        const data = await res.json();
        const newStatuses: Record<string, string> = { ...appliedStatuses };
        if (isMcp) {
          // Results come back in the same order as the approved actions we
          // sent. Match by index — NOT by tool name, because multiple actions
          // can have the same tool (e.g., 3× link_document_to_entity).
          const approvedActions = stagedActions.filter((a) => approved.includes(a.id));
          const results = (data.results || []) as Array<{ tool: string; status: string; error?: string }>;
          for (let i = 0; i < results.length && i < approvedActions.length; i++) {
            newStatuses[approvedActions[i].id] = results[i].status;
          }
          for (const a of stagedActions) {
            if (!approved.includes(a.id) && !newStatuses[a.id]) newStatuses[a.id] = "rejected";
          }
        } else {
          for (const result of data.results || []) {
            newStatuses[result.action_id] = result.status;
          }
          for (const action of actions) {
            if (!approved.includes(action.id) && !newStatuses[action.id]) {
              newStatuses[action.id] = "rejected";
            }
          }
        }
        setAppliedStatuses(newStatuses);
        // Persist to DB so the state survives navigation/reload.
        fetch(`/api/chat/sessions/${sessionId}/messages/${messageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata_merge: { applied_statuses: newStatuses } }),
        }).catch(() => {/* non-fatal */});
        onActionsApplied({ applied: data.applied || 0, failed: data.failed || 0, follow_up: data.follow_up });
      } else {
        alert("Failed to apply actions");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to apply actions");
    } finally {
      setApplying(false);
    }
  };

  const handleSkipAll = async () => {
    setApplying(true);
    try {
      if (!isMcp) {
        await fetch("/api/chat/apply-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, skip_all: true }),
        });
      }
      const newStatuses: Record<string, string> = {};
      const items = isMcp ? stagedActions : actions;
      for (const a of items) newStatuses[a.id] = "rejected";
      setAppliedStatuses(newStatuses);
      fetch(`/api/chat/sessions/${sessionId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata_merge: { applied_statuses: newStatuses } }),
      }).catch(() => {/* non-fatal */});
      onActionsApplied({ applied: 0, failed: 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      {/* Processed files summary */}
      {attachments.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {attachments.map((att, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "4px 0",
              fontSize: 12, color: att.status === "error" ? "#c73e3e" : "#6b6b76",
            }}>
              <span>{att.status === "error" ? "✗" : "✓"}</span>
              <span style={{ fontWeight: 500 }}>{att.filename}</span>
              {att.proposed_type && <span>· {att.proposed_type.replace(/_/g, " ")}</span>}
              {att.proposed_entity?.name && <span>· {att.proposed_entity.name}</span>}
              {att.proposed_year && <span>· {att.proposed_year}</span>}
            </div>
          ))}
        </div>
      )}

      {/* MCP staged actions — rendering via the shared StagedActionsList
          primitive so /review's ReviewCard can use the same component.
          We own the submit / persistence logic up here. */}
      {isMcp && stagedActions.length > 0 && (
        <>
          <StagedActionsList
            actions={stagedActions.map((s) => ({
              id: s.id,
              tool: s.tool,
              summary: s.summary,
              status: appliedStatuses[s.id],
            }))}
            checkedIds={checkedIds}
            onToggle={toggleAction}
            disabled={applying}
            // Group actions by document. Actions touching the same doc
            // (e.g. update_document + link_document_to_investment +
            // update_investment_transaction with document_id) collapse
            // under one header instead of being spread across the list.
            // Actions without a document_id (create_entity, etc.) fall
            // into the "Other" bucket via key = __other__.
            groupBy={(action) => {
              const staged = stagedActions.find((s) => s.id === action.id);
              const docId = (staged?.input as { document_id?: string } | undefined)
                ?.document_id;
              if (!docId || typeof docId !== "string") return null;
              const name = docNameMap[docId] ?? `Document ${docId.slice(0, 8)}…`;
              return { key: docId, label: `📄 ${name}` };
            }}
          />
          {!allApplied && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                onClick={handleApply}
                disabled={applying || checkedIds.size === 0}
                style={{
                  flex: 1, padding: "8px 12px", fontSize: 13, fontWeight: 600,
                  background: "#2d5a3d", color: "white", border: "none", borderRadius: 6,
                  cursor: applying ? "wait" : "pointer", opacity: applying || checkedIds.size === 0 ? 0.5 : 1,
                }}
              >
                {applying ? "Applying..." : `Approve ${checkedIds.size} action${checkedIds.size !== 1 ? "s" : ""}`}
              </button>
              <button
                onClick={handleSkipAll}
                disabled={applying}
                style={{
                  padding: "8px 12px", fontSize: 13, fontWeight: 500,
                  background: "white", color: "#6b6b76", border: "1px solid #d0d0d8", borderRadius: 6,
                  cursor: applying ? "wait" : "pointer",
                }}
              >
                Skip All
              </button>
            </div>
          )}
        </>
      )}

      {/* Legacy proposed actions (pipeline format) */}
      {!isMcp && actions.length > 0 && (
        <div style={{
          background: "#f8f7f4", borderRadius: 10, padding: 12,
          border: "1px solid #e8e6df",
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Proposed Actions
          </div>

          {actions.map((action) => {
            const status = appliedStatuses[action.id];
            const isApplied = status === "applied";
            const isRejected = status === "rejected";
            const isFailed = status === "failed";
            const isPending = !status || status === "pending";
            const label = ACTION_LABELS[action.action] || { label: action.action.replace(/_/g, " "), color: "#6b6b76" };

            return (
              <div key={action.id} style={{
                display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0",
                borderBottom: "1px solid #e8e6df",
                opacity: isRejected ? 0.4 : 1,
              }}>
                <input
                  type="checkbox"
                  checked={isApplied || checkedIds.has(action.id)}
                  disabled={!isPending || applying}
                  onChange={() => toggleAction(action.id)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                      background: `${label.color}15`, color: label.color, textTransform: "uppercase",
                    }}>
                      {label.label}
                    </span>
                    {isApplied && <span style={{ fontSize: 11, color: "#2d8a4e" }}>✓ Applied</span>}
                    {isFailed && <span style={{ fontSize: 11, color: "#c73e3e" }}>✗ Failed</span>}
                    {isRejected && <span style={{ fontSize: 11, color: "#9494a0" }}>Skipped</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#1a1a1f", marginTop: 2 }}>
                    {action.description}
                  </div>
                  {(() => {
                    const details = getActionDetails(action);
                    return details.length > 0 ? (
                      <div style={{ fontSize: 11, color: "#6b6b76", marginTop: 3, lineHeight: 1.5 }}>
                        {details.map((d, i) => (
                          <div key={i}>{d}</div>
                        ))}
                      </div>
                    ) : null;
                  })()}
                  {isFailed && action.error && (() => {
                    const distMath = parseDistributionMathError(action.error);
                    const contribMath = parseContributionMathError(action.error);
                    const investmentId = (action.data as Record<string, unknown>)?.investment_id as string | undefined;
                    const fixHref = investmentId && /^[0-9a-f-]{36}$/i.test(investmentId)
                      ? `/investments/${investmentId}?tab=transactions`
                      : null;

                    if (distMath) {
                      return (
                        <div
                          style={{
                            marginTop: 6,
                            padding: "10px 12px",
                            background: "#fef6e4",
                            border: "1px solid #f4d99a",
                            borderRadius: 6,
                            color: "#7a5a18",
                            fontSize: 11,
                            lineHeight: 1.5,
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 4, color: "#5a3d00" }}>
                            Source document math doesn&apos;t reconcile
                          </div>
                          <div style={{ marginBottom: 6 }}>
                            The values extracted from the source document don&apos;t add up to the stated net.
                            This usually means there&apos;s an unlabeled fee, rounding adjustment, or hidden
                            line item in the original PDF that wasn&apos;t captured here.
                          </div>
                          <div
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              fontSize: 10,
                              padding: "6px 8px",
                              background: "rgba(255,255,255,0.6)",
                              borderRadius: 4,
                              marginBottom: 6,
                            }}
                          >
                            <div>Gross{"\u00a0\u00a0\u00a0\u00a0\u00a0"}{fmtDollars(distMath.gross)}</div>
                            <div>Deductions{"\u00a0"}({fmtDollars(distMath.reductions)})</div>
                            <div style={{ borderTop: "1px solid #d9c98a", marginTop: 2, paddingTop: 2 }}>
                              Computed{"\u00a0\u00a0"}{fmtDollars(distMath.computedNet)}
                            </div>
                            <div>Stated{"\u00a0\u00a0\u00a0\u00a0\u00a0"}{fmtDollars(distMath.statedNet)}</div>
                            <div style={{ marginTop: 2, fontWeight: 600, color: "#5a3d00" }}>
                              Off by{"\u00a0\u00a0\u00a0"}{fmtDollars(distMath.discrepancy)}
                            </div>
                          </div>
                          {fixHref && (
                            <a
                              href={fixHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: "#3366a8",
                                textDecoration: "none",
                                fontWeight: 500,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                            >
                              Open investment to fix manually →
                            </a>
                          )}
                        </div>
                      );
                    }

                    if (contribMath) {
                      return (
                        <div
                          style={{
                            marginTop: 6,
                            padding: "10px 12px",
                            background: "#fef6e4",
                            border: "1px solid #f4d99a",
                            borderRadius: 6,
                            color: "#7a5a18",
                            fontSize: 11,
                            lineHeight: 1.5,
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 4, color: "#5a3d00" }}>
                            Source document math doesn&apos;t reconcile
                          </div>
                          <div style={{ marginBottom: 6 }}>
                            Line items sum to {fmtDollars(contribMath.sum)} but the stated total is{" "}
                            {fmtDollars(contribMath.amount)} (off by {fmtDollars(contribMath.discrepancy)}).
                            This usually means there&apos;s an unlabeled fee in the source document.
                          </div>
                          {fixHref && (
                            <a
                              href={fixHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: "#3366a8",
                                textDecoration: "none",
                                fontWeight: 500,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                            >
                              Open investment to fix manually →
                            </a>
                          )}
                        </div>
                      );
                    }

                    // Fallback for any other error type — keep the raw message.
                    return (
                      <div
                        style={{
                          marginTop: 6,
                          padding: "6px 10px",
                          background: "#fbe8e8",
                          border: "1px solid #f4b8b8",
                          borderRadius: 6,
                          color: "#7a1818",
                          fontSize: 11,
                          lineHeight: 1.4,
                          wordBreak: "break-word",
                        }}
                      >
                        <strong>Why it failed:</strong> {action.error}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}

          {/* Buttons */}
          {pendingItems.length > 0 && !allApplied && (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button
                onClick={handleSkipAll}
                disabled={applying}
                style={{
                  padding: "6px 14px", borderRadius: 7, border: "1px solid #ddd9d0",
                  background: "none", cursor: "pointer", color: "#6b6b76", fontSize: 12, fontWeight: 500,
                }}
              >
                Skip All
              </button>
              <button
                onClick={handleApply}
                disabled={applying || checkedIds.size === 0}
                style={{
                  padding: "6px 14px", borderRadius: 7, border: "none",
                  background: checkedIds.size > 0 && !applying ? "#2d5a3d" : "#ddd9d0",
                  color: checkedIds.size > 0 && !applying ? "#fff" : "#9494a0",
                  cursor: checkedIds.size > 0 && !applying ? "pointer" : "not-allowed",
                  fontSize: 12, fontWeight: 600,
                }}
              >
                {applying ? "Applying..." : `Apply Selected (${checkedIds.size})`}
              </button>
            </div>
          )}

          {allApplied && (
            <div style={{ fontSize: 12, color: "#2d8a4e", marginTop: 8, fontWeight: 500 }}>
              All actions processed.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CompactActionSummary                                               */
/* ------------------------------------------------------------------ */

// Renders when the number of pending staged actions exceeds ACTION_THRESHOLD.
// Groups actions by tool/action key and shows counts using the existing
// ACTION_LABELS map; falls back to a humanized version of the raw key for
// any tool we haven't labeled. The "Review & Approve" CTA expands the same
// card in-place into the full checkbox list rather than navigating away —
// these are chat-message-scoped staged actions, not pipeline queue items,
// so the global /review page would have nothing to show.

type CompactItem =
  | { tool: string; id: string }
  | { action: string; id: string };

function compactKey(item: CompactItem): string {
  return ("tool" in item ? item.tool : item.action) || "unknown";
}

function CompactActionSummary({
  pending,
  onExpand,
}: {
  pending: CompactItem[];
  onExpand: () => void;
}) {
  const counts = new Map<string, number>();
  for (const item of pending) {
    const key = compactKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  // Sort by count desc, then by label asc for stable display.
  const groups = Array.from(counts.entries())
    .map(([key, count]) => {
      const label = ACTION_LABELS[key]?.label ?? humanizeKey(key);
      const color = ACTION_LABELS[key]?.color ?? "#6b6b76";
      return { key, label, color, count };
    })
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e8e6df",
      borderRadius: 10,
      padding: 16,
      marginTop: 8,
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f" }}>
        {pending.length} actions ready for review
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {groups.map((g) => (
          <div key={g.key} style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 13, color: "#1a1a1f",
          }}>
            <span style={{
              width: 24, textAlign: "right", fontWeight: 600, color: "#6b6b76",
            }}>{g.count}×</span>
            <span style={{
              padding: "2px 8px", borderRadius: 4,
              fontSize: 11, fontWeight: 600,
              background: `${g.color}14`,
              color: g.color,
            }}>
              {g.label}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onExpand}
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          fontSize: 13, fontWeight: 600,
          color: "#fff", background: "#2d5a3d",
          border: "none", borderRadius: 6, cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Review &amp; Approve →
      </button>
    </div>
  );
}
