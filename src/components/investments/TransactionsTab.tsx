"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import type { InvestmentInvestor, TransactionLineItem } from "@/lib/types/investments";
import { AddTransactionModal } from "./AddTransactionModal";

interface Transaction {
  id: string;
  investment_investor_id: string;
  member_directory_id: string | null;
  transaction_type: string;
  amount: number;
  transaction_date: string;
  description: string | null;
  parent_transaction_id: string | null;
  // Spec 036
  line_items: TransactionLineItem[] | null;
  adjusts_transaction_id: string | null;
  adjustment_reason: string | null;
  // Document link (joined by the GET route)
  document_id: string | null;
  document_name: string | null;
  member_name: string | null;
  investor_entity_name?: string | null;
}

// Spec 036 categories.
const LINE_ITEM_LABELS: Record<string, string> = {
  // Contribution side
  subscription: "Subscription",
  management_fee: "Management Fee",
  monitoring_fee: "Monitoring Fee",
  organizational_expense: "Organizational Expense",
  audit_tax_expense: "Audit & Tax Expense",
  legal_expense: "Legal Expense",
  late_fee: "Late Fee",
  other_contribution_expense: "Other Expense",
  // Distribution side
  gross_distribution: "Gross Distribution",
  operating_cashflows: "Operating Cashflows",
  return_of_capital: "Return of Capital",
  carried_interest: "Carried Interest",
  compliance_holdback: "Compliance Holdback",
  tax_withholding: "Tax Withholding",
  other_distribution_adjustment: "Other Adjustment",
};

function fmtSignedDollars(n: number): string {
  if (n < 0) return `(${fmtDollars(Math.abs(n))})`;
  return fmtDollars(n);
}

interface Props {
  investmentId: string;
  investors: InvestmentInvestor[];
  isMobile: boolean;
  /** Fired after a save/delete that changes the investment's totals so the
   *  parent page can refetch its header stats (Called/Uncalled/Cash Invested). */
  onTransactionsChanged?: () => void;
}

const TXN_TYPE_COLORS: Record<string, { label: string; color: string; bg: string }> = {
  contribution: { label: "Contribution", color: "#2d8a4e", bg: "rgba(45,138,78,0.10)" },
  distribution: { label: "Distribution", color: "#3366a8", bg: "rgba(51,102,168,0.10)" },
  return_of_capital: { label: "Return of Capital", color: "#c47520", bg: "rgba(196,117,32,0.10)" },
};

function fmtDollars(n: number): string {
  // Transaction rows always show cents — exact match to source documents
  // matters here. Header summary stats round to whole dollars (separate
  // formatter on the parent page).
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; original: Transaction }
  | { mode: "adjust"; original: Transaction };

export function TransactionsTab({ investmentId, investors, isMobile, onTransactionsChanged }: Props) {
  void isMobile;
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTxnIds, setExpandedTxnIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });

  const fetchTransactions = useCallback(async () => {
    try {
      const res = await fetch(`/api/investments/${investmentId}/transactions`);
      if (res.ok) setTransactions(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [investmentId]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  const handleDelete = async (txnId: string) => {
    if (!confirm("Delete this transaction and all member splits?")) return;
    try {
      const res = await fetch(`/api/investments/${investmentId}/transactions`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: txnId }),
      });
      if (res.ok) {
        fetchTransactions();
        onTransactionsChanged?.();
      }
    } catch (err) { console.error(err); }
  };

  // Parents are top-level rows (no parent_transaction_id). Spec 036: line
  // items live in JSONB on the parent, NOT as child rows. Member splits are
  // still child rows and are kept for the orthogonal per-member feature.
  const parentTxns = transactions.filter(t => t.parent_transaction_id === null);
  const memberSplitTxns = transactions.filter(
    t => t.parent_transaction_id !== null && t.member_directory_id !== null
  );

  // Quick lookup for "→ adjusts: <date>" rendering on adjustment rows.
  const txnById = new Map(transactions.map(t => [t.id, t]));

  // Map investor IDs to names
  const investorNameMap = new Map(investors.map(i => [i.id, i.entity_name || "Unknown"]));

  if (loading) return <div style={{ color: "#9494a0", fontSize: 13, padding: "20px 0" }}>Loading transactions...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#1a1a1f" }}>Transaction History</h3>
        <Button variant="primary" onClick={() => setModal({ mode: "create" })}>
          <PlusIcon size={14} /> Record Transaction
        </Button>
      </div>

      {parentTxns.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "#9494a0", fontSize: 13 }}>No transactions recorded yet.</div>
      ) : (
        <div>
          {parentTxns.map(txn => {
            const typeInfo = TXN_TYPE_COLORS[txn.transaction_type] || TXN_TYPE_COLORS.contribution;
            const memberSplits = memberSplitTxns.filter(c => c.parent_transaction_id === txn.id);
            const lineItems = Array.isArray(txn.line_items) ? txn.line_items : [];
            const investorName = investorNameMap.get(txn.investment_investor_id) || txn.investor_entity_name;
            const hasLineItems = lineItems.length > 0;
            const isExpanded = expandedTxnIds.has(txn.id);
            const isAdjustment = !!txn.adjusts_transaction_id;
            const adjustedRow = txn.adjusts_transaction_id ? txnById.get(txn.adjusts_transaction_id) : null;
            const isDistribution = txn.transaction_type === "distribution";

            const toggleExpanded = () => {
              setExpandedTxnIds(prev => {
                const next = new Set(prev);
                if (next.has(txn.id)) next.delete(txn.id);
                else next.add(txn.id);
                return next;
              });
            };

            return (
              <div
                key={txn.id}
                onClick={hasLineItems ? toggleExpanded : undefined}
                role={hasLineItems ? "button" : undefined}
                tabIndex={hasLineItems ? 0 : undefined}
                aria-expanded={hasLineItems ? isExpanded : undefined}
                onKeyDown={
                  hasLineItems
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleExpanded();
                        }
                      }
                    : undefined
                }
                style={{
                  padding: "14px 12px",
                  marginLeft: -12,
                  marginRight: -12,
                  borderRadius: 8,
                  borderBottom: "1px solid #e8e6df",
                  cursor: hasLineItems ? "pointer" : "default",
                  transition: "background-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (hasLineItems) e.currentTarget.style.backgroundColor = "rgba(45,90,61,0.04)";
                }}
                onMouseLeave={(e) => {
                  if (hasLineItems) e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, color: "#9494a0" }}>{fmtDate(txn.transaction_date)}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: typeInfo.color }}>{typeInfo.label}</span>
                      {investors.length > 1 && investorName && (
                        <span style={{ fontSize: 11, color: "#9494a0", background: "#f0eee8", padding: "1px 6px", borderRadius: 4 }}>{investorName}</span>
                      )}
                      {isAdjustment && (
                        <span
                          title={txn.adjustment_reason || "No reason recorded"}
                          style={{
                            fontSize: 11,
                            color: "#7a5a18",
                            background: "#fef6e4",
                            border: "1px solid #f4d99a",
                            padding: "1px 6px",
                            borderRadius: 4,
                            cursor: "help",
                          }}
                        >
                          → adjusts {adjustedRow ? fmtDate(adjustedRow.transaction_date) : "transaction"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f", marginTop: 2 }}>
                      {fmtSignedDollars(Number(txn.amount))}
                    </div>
                    {txn.description && <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2 }}>{txn.description}</div>}
                    {memberSplits.length > 0 && (
                      <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4 }}>
                        Split: {memberSplits.map(c => `${c.member_name || "?"} ${fmtDollars(Number(c.amount))}`).join(" · ")}
                      </div>
                    )}
                    {hasLineItems && isExpanded && (
                      <div
                        style={{
                          marginTop: 8,
                          marginLeft: 20,
                          paddingLeft: 12,
                          borderLeft: "2px solid #e8e6df",
                          fontSize: 12,
                          color: "#4a4a52",
                        }}
                      >
                        {lineItems.map((li, i) => {
                          // On distributions, all categories EXCEPT gross_distribution
                          // are shown as parenthesized reductions to make the
                          // waterfall math obvious.
                          const isReduction = isDistribution && li.category !== "gross_distribution";
                          const displayAmount = isReduction ? -Math.abs(Number(li.amount)) : Number(li.amount);
                          return (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "3px 0",
                              }}
                            >
                              <span>
                                {li.description || LINE_ITEM_LABELS[li.category] || li.category}
                              </span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                                {fmtSignedDollars(displayAmount)}
                              </span>
                            </div>
                          );
                        })}
                        <div
                          style={{
                            marginTop: 4,
                            paddingTop: 4,
                            borderTop: "1px solid #e8e6df",
                            display: "flex",
                            justifyContent: "space-between",
                            fontWeight: 600,
                            color: "#1a1a1f",
                          }}
                        >
                          <span>{isDistribution ? "Net Distribution" : "Total"}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>
                            {fmtSignedDollars(Number(txn.amount))}
                          </span>
                        </div>
                        {txn.document_id && (
                          <div style={{ marginTop: 8, fontSize: 12 }}>
                            <span style={{ color: "#9494a0" }}>Source document: </span>
                            <a
                              href={`/api/documents/${txn.document_id}/download`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ color: "#3366a8", textDecoration: "none" }}
                              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                            >
                              📄 {txn.document_name || "View document"}
                            </a>
                          </div>
                        )}
                        {/* Record Amendment — buried inside the expand panel.
                            For after-the-fact financial changes (recall, corrected
                            wire). NOT for typo fixes — those use Edit on the row. */}
                        {!isAdjustment && (
                          <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px dashed #e8e6df" }}>
                            <button
                              onClick={(e) => { e.stopPropagation(); setModal({ mode: "adjust", original: txn }); }}
                              style={{
                                background: "none",
                                border: "1px solid #ddd9d0",
                                color: "#6b6b76",
                                fontSize: 11,
                                padding: "4px 10px",
                                borderRadius: 6,
                                cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                              title="Record an after-the-fact financial amendment (e.g., sponsor recall). For typos use Edit instead."
                            >
                              Record amendment…
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* If row has no line items, still show document link as a one-liner under the row */}
                    {!hasLineItems && txn.document_id && (
                      <div style={{ marginTop: 4, fontSize: 12 }}>
                        <a
                          href={`/api/documents/${txn.document_id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: "#3366a8", textDecoration: "none" }}
                          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                        >
                          📄 {txn.document_name || "Source document"}
                        </a>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                    {!isAdjustment && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setModal({ mode: "edit", original: txn }); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#3366a8", fontSize: 12, padding: "4px 8px" }}
                        title="Fix a typo or update this transaction"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(txn.id); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 12, padding: "4px 8px" }}
                      title="Delete"
                    >
                      Delete
                    </button>
                    {hasLineItems && (
                      <span
                        aria-hidden="true"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 24,
                          marginLeft: 4,
                          color: "#6b6b76",
                          transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          transition: "transform 0.15s",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal.mode !== "closed" && (
        <AddTransactionModal
          investmentId={investmentId}
          investors={investors}
          editOriginal={modal.mode === "edit" ? modal.original : null}
          adjustsOriginal={modal.mode === "adjust" ? modal.original : null}
          onClose={() => setModal({ mode: "closed" })}
          onSaved={() => {
            setModal({ mode: "closed" });
            fetchTransactions();
            onTransactionsChanged?.();
          }}
        />
      )}
    </div>
  );
}
