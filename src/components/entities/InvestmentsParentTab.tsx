"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { DocIcon, DownIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/utils/format";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/constants";
import type { DocumentCategory } from "@/lib/types/entities";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DealAllocation {
  member_directory_id: string;
  member_name: string;
  allocation_pct: number;
  committed_amount: number | null;
}

interface DealTransaction {
  id: string;
  transaction_type: string;
  amount: number;
  transaction_date: string;
  description: string | null;
  document_id: string | null;
  member_directory_id: string | null;
  member_name: string | null;
  parent_transaction_id: string | null;
}

interface DealDocument {
  id: string;
  entity_id: string;
  name: string;
  document_type: string;
  document_category: DocumentCategory | null;
  year: number | null;
  file_path: string;
  created_at: string;
}

interface DealSummary {
  deal_entity_id: string;
  entity_name: string;
  entity_short_name: string | null;
  entity_type: string | null;
  entity_status: string | null;
  ownership_pct: number | null;
  participant_count: number;
  allocations: DealAllocation[];
  total_contributed: number;
  total_distributed: number;
  recent_transactions: DealTransaction[];
  child_transactions: DealTransaction[];
  documents: DealDocument[];
}

interface MemberTotal {
  member_directory_id: string;
  member_name: string;
  deal_count: number;
  total_contributed: number;
  total_distributed: number;
}

interface InvestmentsParentTabProps {
  entityId: string;
  entityName: string;
  isMobile: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDollars(amount: number | null): string {
  if (amount === null || amount === undefined || amount === 0) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDollarsFull(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const TXN_TYPE_LABELS: Record<string, string> = {
  contribution: "Contribution",
  distribution: "Distribution",
  return_of_capital: "Return of Capital",
};

const TXN_TYPE_COLORS: Record<string, { color: string; bg: string }> = {
  contribution: { color: "#2d5a3d", bg: "rgba(45,90,61,0.10)" },
  distribution: { color: "#3366a8", bg: "rgba(51,102,168,0.10)" },
  return_of_capital: { color: "#c47520", bg: "rgba(196,117,32,0.10)" },
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function InvestmentsParentTab({ entityId, entityName, isMobile }: InvestmentsParentTabProps) {
  const router = useRouter();
  const [deals, setDeals] = useState<DealSummary[]>([]);
  const [memberTotals, setMemberTotals] = useState<MemberTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDeals, setExpandedDeals] = useState<Set<string>>(new Set());
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/investments`);
      if (res.ok) {
        const data = await res.json();
        setDeals(data.deals || []);
        setMemberTotals(data.member_totals || []);
        // Auto-expand all deals if small count
        if ((data.deals || []).length <= 5) {
          setExpandedDeals(new Set((data.deals || []).map((d: DealSummary) => d.deal_entity_id)));
        }
      }
    } catch (err) {
      console.error("Failed to load investments:", err);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function toggleDeal(dealId: string) {
    setExpandedDeals((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }

  function toggleDocs(dealId: string) {
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) next.delete(dealId);
      else next.add(dealId);
      return next;
    });
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#9494a0" }}>Loading investments...</div>;
  }

  if (deals.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 0" }}>
        <div style={{ fontSize: 14, color: "#6b6b76", fontWeight: 500 }}>No investments yet</div>
        <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4, maxWidth: 360, margin: "4px auto 0" }}>
          When {entityName} is added to a deal entity&apos;s cap table as an investor, deals will appear here automatically.
        </div>
      </div>
    );
  }

  // Aggregate totals
  const totalInvested = deals.reduce((s, d) => s + d.total_contributed, 0);
  const totalDistributed = deals.reduce((s, d) => s + d.total_distributed, 0);
  const uniqueParticipants = new Set(memberTotals.map((m) => m.member_directory_id)).size;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ---- Summary Stats ---- */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 16 }}>
        <StatBox label="Active Deals" value={String(deals.length)} />
        <StatBox label="Total Invested" value={fmtDollars(totalInvested)} />
        <StatBox label="Total Distributed" value={fmtDollars(totalDistributed)} />
        <StatBox label="Participants" value={String(uniqueParticipants)} />
      </div>

      {/* ---- Member Totals ---- */}
      {memberTotals.length > 0 && (
        <Card>
          <SectionHeader>Member Totals (All Deals)</SectionHeader>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e8e6df" }}>
                  <th style={{ ...thStyle, textAlign: "left" }}>Member</th>
                  <th style={thStyle}>Deals</th>
                  <th style={thStyle}>Contributed</th>
                  <th style={thStyle}>Distributed</th>
                  <th style={thStyle}>Net</th>
                </tr>
              </thead>
              <tbody>
                {memberTotals.map((m) => {
                  const net = m.total_distributed - m.total_contributed;
                  return (
                    <tr key={m.member_directory_id} style={{ borderBottom: "1px solid #f0eee8" }}>
                      <td style={{ padding: "10px 6px", color: "#1a1a1f", fontWeight: 500 }}>{m.member_name}</td>
                      <td style={tdRight}>{m.deal_count}</td>
                      <td style={tdRight}>{fmtDollarsFull(m.total_contributed)}</td>
                      <td style={tdRight}>{fmtDollarsFull(m.total_distributed)}</td>
                      <td style={{ ...tdRight, color: net >= 0 ? "#2d5a3d" : "#c73e3e", fontWeight: 500 }}>
                        {net === 0 ? "\u2014" : (net > 0 ? "+" : "") + fmtDollarsFull(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #e8e6df" }}>
                  <td style={{ padding: "10px 6px", fontWeight: 600, color: "#1a1a1f" }}>Total</td>
                  <td style={tdRight}></td>
                  <td style={{ ...tdRight, fontWeight: 600 }}>{fmtDollarsFull(totalInvested)}</td>
                  <td style={{ ...tdRight, fontWeight: 600 }}>{fmtDollarsFull(totalDistributed)}</td>
                  <td style={{ ...tdRight, fontWeight: 600, color: totalDistributed - totalInvested >= 0 ? "#2d5a3d" : "#c73e3e" }}>
                    {(() => {
                      const net = totalDistributed - totalInvested;
                      return net === 0 ? "\u2014" : (net > 0 ? "+" : "") + fmtDollarsFull(net);
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* ---- Deal Cards ---- */}
      {deals.map((deal) => {
        const isExpanded = expandedDeals.has(deal.deal_entity_id);
        const docsExpanded = expandedDocs.has(deal.deal_entity_id);

        // Group child transactions by parent_transaction_id
        const childByParent: Record<string, DealTransaction[]> = {};
        for (const t of deal.child_transactions) {
          if (t.parent_transaction_id) {
            if (!childByParent[t.parent_transaction_id]) childByParent[t.parent_transaction_id] = [];
            childByParent[t.parent_transaction_id].push(t);
          }
        }

        // Group documents by category
        const docsByCategory: Record<string, DealDocument[]> = {};
        for (const doc of deal.documents) {
          const cat = doc.document_category || "other";
          if (!docsByCategory[cat]) docsByCategory[cat] = [];
          docsByCategory[cat].push(doc);
        }

        return (
          <Card key={deal.deal_entity_id} style={{ padding: 0 }}>
            {/* Deal header — always visible */}
            <div
              onClick={() => toggleDeal(deal.deal_entity_id)}
              style={{
                padding: "18px 22px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f", cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); router.push(`/entities/${deal.deal_entity_id}`); }}
                    title="Go to entity"
                  >
                    {deal.entity_name}
                  </span>
                  {deal.entity_status && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 10,
                      textTransform: "capitalize",
                      color: deal.entity_status === "active" ? "#2d5a3d" : "#6b6b76",
                      background: deal.entity_status === "active" ? "rgba(45,90,61,0.10)" : "rgba(107,107,118,0.10)",
                    }}>
                      {deal.entity_status}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {deal.ownership_pct !== null && (
                    <span>{entityName} Ownership: {deal.ownership_pct}%</span>
                  )}
                  <span>{deal.participant_count} participant{deal.participant_count !== 1 ? "s" : ""}</span>
                  <span>{fmtDollars(deal.total_contributed)} contributed</span>
                </div>
                <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2 }}>
                  Distributions: {fmtDollars(deal.total_distributed)} received
                </div>
              </div>
              <div style={{
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.15s",
                color: "#9494a0",
                flexShrink: 0,
                marginTop: 4,
              }}>
                <DownIcon size={16} />
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div style={{ borderTop: "1px solid #e8e6df", padding: "16px 22px" }}>
                {/* Allocations inline */}
                {deal.allocations.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                      Allocations
                    </div>
                    <div style={{ fontSize: 12, color: "#1a1a1f" }}>
                      {deal.allocations.map((a) =>
                        `${a.member_name} ${Number(a.allocation_pct).toFixed(0)}%`
                      ).join(" \u00B7 ")}
                    </div>
                  </div>
                )}

                {/* Recent Transactions */}
                {deal.recent_transactions.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#6b6b76", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                      Recent Transactions
                    </div>
                    {deal.recent_transactions.map((txn) => {
                      const children = childByParent[txn.id] || [];
                      const typeColor = TXN_TYPE_COLORS[txn.transaction_type] || TXN_TYPE_COLORS.contribution;
                      return (
                        <div key={txn.id} style={{ padding: "6px 0", borderBottom: "1px solid #f5f4f0" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                            <span style={{ color: "#6b6b76" }}>{formatDate(txn.transaction_date)}</span>
                            <span style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "1px 6px",
                              borderRadius: 8,
                              color: typeColor.color,
                              background: typeColor.bg,
                            }}>
                              {TXN_TYPE_LABELS[txn.transaction_type]}
                            </span>
                            <span style={{ fontWeight: 600, color: "#1a1a1f", fontFamily: "'DM Mono', monospace" }}>
                              {fmtDollars(Number(txn.amount))}
                            </span>
                            {txn.document_id && <DocIcon size={12} />}
                          </div>
                          {children.length > 0 && (
                            <div style={{ fontSize: 11, color: "#6b6b76", marginTop: 2 }}>
                              {children.map((c) => `${c.member_name} ${fmtDollars(Number(c.amount))}`).join(" \u00B7 ")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Documents section */}
                {deal.documents.length > 0 && (
                  <div>
                    <div
                      onClick={() => toggleDocs(deal.deal_entity_id)}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#6b6b76",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 8,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      Documents ({deal.documents.length})
                      <span style={{
                        transform: docsExpanded ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.15s",
                        display: "inline-flex",
                      }}>
                        <DownIcon size={10} />
                      </span>
                    </div>

                    {docsExpanded && (
                      <div>
                        {Object.entries(docsByCategory).map(([category, docs]) => (
                          <div key={category} style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 11, fontWeight: 500, color: "#9494a0", marginBottom: 4 }}>
                              {DOCUMENT_CATEGORY_LABELS[category as DocumentCategory] || category}
                            </div>
                            {docs.map((doc) => (
                              <div
                                key={doc.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "4px 0",
                                  fontSize: 12,
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#1a1a1f", flex: 1, minWidth: 0 }}>
                                  <DocIcon size={12} />
                                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {doc.name}
                                  </span>
                                  {doc.year && (
                                    <span style={{ fontSize: 10, color: "#9494a0", flexShrink: 0 }}>({doc.year})</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                        <div style={{ marginTop: 8 }}>
                          <button
                            onClick={() => router.push(`/entities/${deal.deal_entity_id}?tab=documents`)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#3366a8",
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: "pointer",
                              padding: 0,
                              fontFamily: "inherit",
                            }}
                          >
                            View All on Entity &rarr;
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Quick nav */}
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <Button size="sm" onClick={() => router.push(`/entities/${deal.deal_entity_id}?tab=investment`)}>
                    View Details
                  </Button>
                  <Button size="sm" onClick={() => router.push(`/entities/${deal.deal_entity_id}?tab=documents`)}>
                    Documents
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e8e6df", borderRadius: 12, padding: "16px 20px" }}>
      <div style={{ fontSize: 11, color: "#6b6b76", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, fontFamily: "'DM Mono', monospace", color: "#1a1a1f" }}>
        {value}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 6px",
  fontSize: 11,
  fontWeight: 600,
  color: "#6b6b76",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  textAlign: "right",
};

const tdRight: React.CSSProperties = {
  padding: "10px 6px",
  textAlign: "right",
  fontFamily: "'DM Mono', monospace",
  color: "#1a1a1f",
};
