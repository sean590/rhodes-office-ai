"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PlusIcon, ChartIcon } from "@/components/ui/icons";
import { INVESTMENT_TYPE_COLORS, INVESTMENT_TYPE_LABELS, INVESTMENT_STATUS_COLORS, INVESTMENT_STATUS_LABELS } from "@/lib/utils/investment-colors";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { AddInvestmentModal } from "@/components/investments/AddInvestmentModal";
import type { InvestmentType, InvestmentStatus } from "@/lib/types/investments";

interface InvestmentListItem {
  id: string;
  name: string;
  short_name: string | null;
  investment_type: InvestmentType;
  status: InvestmentStatus;
  date_invested: string | null;
  investor_count: number;
  investor_names: string[];
  participant_count: number;
  total_contributed: number;
  total_distributed: number;
}

function fmtDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function InvestmentsPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [investments, setInvestments] = useState<InvestmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchInvestments = useCallback(async () => {
    try {
      const res = await fetch("/api/investments");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setInvestments(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvestments();
  }, [fetchInvestments]);

  const setPageContext = useSetPageContext();
  useEffect(() => {
    setPageContext({ page: "investments" });
    return () => setPageContext(null);
  }, [setPageContext]);

  const filtered = useMemo(() => {
    if (!search.trim()) return investments;
    const q = search.toLowerCase();
    return investments.filter((inv) => {
      const typeLabel = INVESTMENT_TYPE_LABELS[inv.investment_type]?.toLowerCase() ?? "";
      const investorStr = inv.investor_names.join(" ").toLowerCase();
      return (
        inv.name.toLowerCase().includes(q) ||
        typeLabel.includes(q) ||
        investorStr.includes(q)
      );
    });
  }, [investments, search]);

  const activeCount = investments.filter((i) => i.status === "active").length;
  const totalContributed = investments.reduce((sum, i) => sum + i.total_contributed, 0);
  const totalDistributed = investments.reduce((sum, i) => sum + i.total_distributed, 0);

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f" }}>Investments</div>
        <div style={{ marginTop: 24, color: "#9494a0", fontSize: 13 }}>Loading...</div>
      </div>
    );
  }

  if (investments.length === 0) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f", margin: 0 }}>Investments</h1>
        <div style={{
          marginTop: 80, display: "flex", flexDirection: "column", alignItems: "center",
          textAlign: "center", padding: "0 24px",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: "rgba(45,90,61,0.08)", display: "flex",
            alignItems: "center", justifyContent: "center", marginBottom: 20,
          }}>
            <ChartIcon size={28} color="#2d5a3d" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1a1a1f", margin: "0 0 8px" }}>
            No investments yet
          </h2>
          <p style={{ fontSize: 14, color: "#6b6b76", maxWidth: 360, margin: "0 0 24px", lineHeight: 1.5 }}>
            Add investments to track allocations, contributions, distributions, and documents for each deal.
          </p>
          <Button variant="primary" onClick={() => setShowAddModal(true)}>
            <PlusIcon size={14} />
            Add Investment
          </Button>
        </div>
        {showAddModal && (
          <AddInvestmentModal
            onClose={() => setShowAddModal(false)}
            onCreated={() => { setShowAddModal(false); fetchInvestments(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{
        display: "flex", flexDirection: isMobile ? "column" : "row",
        justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start",
        gap: isMobile ? 12 : 0,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f", margin: 0 }}>Investments</h1>
        </div>
        <Button variant="primary" onClick={() => setShowAddModal(true)}>
          <PlusIcon size={14} />
          Add Investment
        </Button>
      </div>

      {/* Summary stats */}
      <div style={{ marginTop: 20, display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[
          { label: "Active Deals", value: String(activeCount) },
          { label: "Total Invested", value: fmtDollars(totalContributed) },
          { label: "Total Distributed", value: fmtDollars(totalDistributed) },
          { label: "Net", value: fmtDollars(totalDistributed - totalContributed) },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: "#f8f7f4", borderRadius: 10, padding: "12px 20px",
            flex: isMobile ? "1 1 calc(50% - 8px)" : "0 0 auto",
          }}>
            <div style={{ fontSize: 11, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1f", marginTop: 2 }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 20, maxWidth: 320 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search investments..." />
      </div>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map((inv) => {
          const typeColor = INVESTMENT_TYPE_COLORS[inv.investment_type] || INVESTMENT_TYPE_COLORS.other;
          const statusColor = INVESTMENT_STATUS_COLORS[inv.status] || INVESTMENT_STATUS_COLORS.active;
          return (
            <div
              key={inv.id}
              onClick={() => router.push(`/investments/${inv.id}`)}
              style={{
                background: "#ffffff", border: "1px solid #e8e6df", borderRadius: 10,
                padding: "16px 20px", cursor: "pointer",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#d0cdc4";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#e8e6df";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f" }}>{inv.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                    <Badge label={INVESTMENT_TYPE_LABELS[inv.investment_type]} color={typeColor.text} bg={typeColor.bg} />
                    <span style={{ fontSize: 12, color: "#6b6b76" }}>
                      {inv.participant_count} participant{inv.participant_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <Badge label={INVESTMENT_STATUS_LABELS[inv.status]} color={statusColor.text} bg={statusColor.bg} />
              </div>
              {inv.investor_names.length > 0 && (
                <div style={{ fontSize: 12, color: "#9494a0", marginTop: 6 }}>
                  via {inv.investor_names.join(", ")}
                </div>
              )}
              <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 13, color: "#6b6b76" }}>
                <span>Contributed: {fmtDollars(inv.total_contributed)}</span>
                <span>Distributed: {fmtDollars(inv.total_distributed)}</span>
                {inv.date_invested && (
                  <span>Invested: {new Date(inv.date_invested + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showAddModal && (
        <AddInvestmentModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); fetchInvestments(); }}
        />
      )}
    </div>
  );
}
