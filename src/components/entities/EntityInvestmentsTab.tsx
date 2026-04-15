"use client";

/**
 * EntityInvestmentsTab
 *
 * Renders the "Investments" tab on the entity detail page. Lists every
 * investment (from the v2 `investments` table) where the current entity is
 * an active investor — name, type, status, date invested, capital contributed
 * and distributed (scoped to this entity by the API). Click-through navigates
 * to the dedicated investment detail page.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartIcon, PlusIcon } from "@/components/ui/icons";
import {
  INVESTMENT_TYPE_COLORS,
  INVESTMENT_TYPE_LABELS,
  INVESTMENT_STATUS_COLORS,
  INVESTMENT_STATUS_LABELS,
} from "@/lib/utils/investment-colors";
import type { InvestmentType, InvestmentStatus } from "@/lib/types/investments";

interface EntityInvestmentRow {
  id: string;
  name: string;
  short_name: string | null;
  investment_type: InvestmentType;
  status: InvestmentStatus;
  date_invested: string | null;
  investor_count: number;
  investor_names: string[];
  participant_count: number;
  total_committed: number;
  total_contributed: number;
  total_distributed: number;
  // Spec 036 derived fields
  called_capital: number;
  uncalled_capital: number;
  total_distributed_gross: number;
  total_distributed_net: number;
}

function fmtDollars(n: number): string {
  if (!n) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function EntityInvestmentsTab({
  entityId,
  entityName,
}: {
  entityId: string;
  entityName: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EntityInvestmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/investments?entity_id=${encodeURIComponent(entityId)}`);
      if (!res.ok) throw new Error("Failed to load investments");
      const data = (await res.json()) as EntityInvestmentRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("EntityInvestmentsTab fetch error:", err);
      setError("Could not load investments.");
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.status === "active").length;
    const committed = rows.reduce((s, r) => s + (r.total_committed || 0), 0);
    const called = rows.reduce((s, r) => s + (r.called_capital || 0), 0);
    const uncalled = rows.reduce((s, r) => s + (r.uncalled_capital || 0), 0);
    const contributed = rows.reduce((s, r) => s + (r.total_contributed || 0), 0);
    const distributed = rows.reduce((s, r) => s + (r.total_distributed || 0), 0);
    return {
      active,
      committed,
      called,
      uncalled,
      contributed, // total cash invested (includes fees)
      distributed,
      net: distributed - contributed,
    };
  }, [rows]);

  if (loading) {
    return (
      <div style={{ color: "#9494a0", fontSize: 13, padding: "16px 0" }}>
        Loading investments…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          background: "#fff4f4",
          border: "1px solid #f5c6c6",
          borderRadius: 10,
          padding: "12px 16px",
          color: "#a13030",
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          background: "#ffffff",
          border: "1px dashed #ddd9d0",
          borderRadius: 12,
          padding: "40px 24px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: "rgba(45,90,61,0.08)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          <ChartIcon size={22} color="#2d5a3d" />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f", marginBottom: 6 }}>
          No investments yet
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#6b6b76",
            maxWidth: 360,
            margin: "0 auto 18px",
            lineHeight: 1.5,
          }}
        >
          {entityName} isn&rsquo;t listed as an investor on any deal yet. Add an
          investment to start tracking contributions and distributions.
        </div>
        <Button variant="primary" onClick={() => router.push("/investments")}>
          <PlusIcon size={14} />
          Add Investment
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Summary stats — spec 036: surface called/uncalled capital alongside cash invested */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        {[
          { label: "Active Deals", value: String(summary.active) },
          { label: "Committed", value: fmtDollars(summary.committed) },
          { label: "Called", value: fmtDollars(summary.called) },
          { label: "Uncalled", value: fmtDollars(summary.uncalled) },
          { label: "Cash Invested", value: fmtDollars(summary.contributed) },
          { label: "Distributed", value: fmtDollars(summary.distributed) },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "#f8f7f4",
              borderRadius: 10,
              padding: "12px 20px",
              flex: "0 0 auto",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#9494a0",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
              }}
            >
              {stat.label}
            </div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#1a1a1f",
                marginTop: 2,
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Investment rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.map((inv) => {
          const typeColor =
            INVESTMENT_TYPE_COLORS[inv.investment_type] || INVESTMENT_TYPE_COLORS.other;
          const statusColor =
            INVESTMENT_STATUS_COLORS[inv.status] || INVESTMENT_STATUS_COLORS.active;
          return (
            <div
              key={inv.id}
              onClick={() => router.push(`/investments/${inv.id}`)}
              style={{
                background: "#ffffff",
                border: "1px solid #e8e6df",
                borderRadius: 10,
                padding: "16px 20px",
                cursor: "pointer",
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1f" }}>
                    {inv.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <Badge
                      label={INVESTMENT_TYPE_LABELS[inv.investment_type]}
                      color={typeColor.text}
                      bg={typeColor.bg}
                    />
                    <span style={{ fontSize: 12, color: "#6b6b76" }}>
                      {inv.participant_count} participant
                      {inv.participant_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <Badge
                  label={INVESTMENT_STATUS_LABELS[inv.status]}
                  color={statusColor.text}
                  bg={statusColor.bg}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginTop: 10,
                  fontSize: 13,
                  color: "#6b6b76",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  <span style={{ color: "#9494a0" }}>Invested:</span>{" "}
                  <span style={{ color: "#1a1a1f", fontWeight: 500 }}>
                    {fmtDollars(inv.total_contributed)}
                  </span>
                </span>
                <span>
                  <span style={{ color: "#9494a0" }}>Distributed:</span>{" "}
                  <span style={{ color: "#1a1a1f", fontWeight: 500 }}>
                    {fmtDollars(inv.total_distributed)}
                  </span>
                </span>
                <span>
                  <span style={{ color: "#9494a0" }}>Date:</span>{" "}
                  <span style={{ color: "#1a1a1f", fontWeight: 500 }}>
                    {fmtDate(inv.date_invested)}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
