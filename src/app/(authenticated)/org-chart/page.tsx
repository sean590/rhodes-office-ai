"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Dot } from "@/components/ui/dot";
import { LinkIcon } from "@/components/ui/icons";
import { ENTITY_TYPE_LABELS } from "@/lib/utils/entity-colors";

// --- Types ---

interface TreeNode {
  id: string;
  name: string;
  type: string;
  formation_state: string;
  additional_reg_count: number;
  filing_status: "current" | "due_soon" | "overdue";
  relationship_count: number;
  children: TreeNode[];
}

// --- Colors ---

const EC: Record<string, { bg: string; border: string; text: string }> = {
  holding_company: { bg: "rgba(45,90,61,0.10)", border: "#2d5a3d", text: "#2d5a3d" },
  investment_fund: { bg: "rgba(51,102,168,0.10)", border: "#3366a8", text: "#3366a8" },
  operating_company: { bg: "rgba(45,138,78,0.10)", border: "#2d8a4e", text: "#2d8a4e" },
  real_estate: { bg: "rgba(123,77,181,0.10)", border: "#7b4db5", text: "#7b4db5" },
  trust: { bg: "rgba(196,117,32,0.10)", border: "#c47520", text: "#c47520" },
  special_purpose: { bg: "rgba(51,102,168,0.10)", border: "#3366a8", text: "#3366a8" },
  management_company: { bg: "rgba(45,90,61,0.10)", border: "#2d5a3d", text: "#2d5a3d" },
  other: { bg: "rgba(148,148,160,0.10)", border: "#9494a0", text: "#9494a0" },
};

const FILING_STATUS_CONFIG: Record<string, { color: string; symbol: string; label: string }> = {
  current: { color: "#2d8a4e", symbol: "\u2713", label: "Current" },
  due_soon: { color: "#a68b1a", symbol: "~", label: "Due Soon" },
  overdue: { color: "#c73e3e", symbol: "!", label: "Overdue" },
};

// --- Node Component ---

function Node({ node }: { node: TreeNode }) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  const colors = EC[node.type] || EC.other;
  const filingConfig = FILING_STATUS_CONFIG[node.filing_status] || FILING_STATUS_CONFIG.current;
  const typeLabel = ENTITY_TYPE_LABELS[node.type as keyof typeof ENTITY_TYPE_LABELS] || node.type;

  const handleClick = useCallback(() => {
    router.push(`/entities/${node.id}`);
  }, [router, node.id]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* The node card */}
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? colors.bg : "#ffffff",
          border: `1.5px solid ${colors.border}`,
          borderRadius: 12,
          padding: "14px 20px",
          minWidth: 210,
          cursor: "pointer",
          textAlign: "center",
          transition: "all 0.15s",
          transform: hovered ? "translateY(-2px)" : "translateY(0)",
          boxShadow: hovered ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
        }}
      >
        {/* Entity name */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
          {node.name}
        </div>

        {/* Entity type */}
        <div style={{ fontSize: 11, fontWeight: 500, color: colors.text, marginBottom: 6 }}>
          {typeLabel}
        </div>

        {/* Formation state + additional registrations */}
        <div style={{ fontSize: 11, color: "#8c8c96", marginBottom: 6 }}>
          {node.formation_state}
          {node.additional_reg_count > 0 && (
            <span style={{ marginLeft: 4, color: "#a0a0a8" }}>
              +{node.additional_reg_count}
            </span>
          )}
        </div>

        {/* Filing status + relationships row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          {/* Filing status */}
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Dot color={filingConfig.color} size={6} />
            <span style={{ fontSize: 11, fontWeight: 500, color: filingConfig.color }}>
              {filingConfig.symbol}
            </span>
          </span>

          {/* Relationship count */}
          {node.relationship_count > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, color: "#8c8c96" }}>
              <LinkIcon size={11} />
              <span style={{ fontSize: 11 }}>{node.relationship_count}</span>
            </span>
          )}
        </div>
      </div>

      {/* Children */}
      {node.children.length > 0 && (
        <>
          {/* Vertical connector from parent to horizontal line */}
          <div style={{ width: 1.5, height: 24, background: "#ddd9d0" }} />

          {/* Children container */}
          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            {/* Horizontal connector spanning children */}
            {node.children.length > 1 && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  height: 1.5,
                  background: "#ddd9d0",
                  /* Calculated to span from center of first child to center of last child */
                  width: "calc(100% - 210px)",
                  minWidth: 20,
                }}
              />
            )}

            <div style={{ display: "flex", gap: 20 }}>
              {node.children.map((child) => (
                <div key={child.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {/* Vertical connector from horizontal line to child */}
                  <div style={{ width: 1.5, height: 24, background: "#ddd9d0" }} />
                  <Node node={child} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- Legend ---

const LEGEND_TYPES = [
  { key: "holding_company", label: "Holding Company" },
  { key: "investment_fund", label: "Investment Fund" },
  { key: "operating_company", label: "Operating Company" },
  { key: "real_estate", label: "Real Estate" },
  { key: "trust", label: "Trust" },
];

// --- Page ---

export default function OrgChartPage() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTree() {
      try {
        const res = await fetch("/api/entities/tree");
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to fetch org chart data");
        }
        const data = await res.json();
        setTree(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch org chart data");
      } finally {
        setLoading(false);
      }
    }
    fetchTree();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
          Organization Chart
        </div>
        <div style={{ fontSize: 13, color: "#8c8c96", marginBottom: 24 }}>
          Click any entity to view details
        </div>
        <div style={{
          background: "#ffffff", borderRadius: 12, border: "1px solid #e8e6df",
          padding: 48, textAlign: "center", color: "#8c8c96", fontSize: 14,
        }}>
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
          Organization Chart
        </div>
        <div style={{ fontSize: 13, color: "#8c8c96", marginBottom: 24 }}>
          Click any entity to view details
        </div>
        <div style={{
          background: "#ffffff", borderRadius: 12, border: "1px solid #e8e6df",
          padding: 48, textAlign: "center", color: "#c73e3e", fontSize: 14,
        }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
          Organization Chart
        </div>
        <div style={{ fontSize: 13, color: "#8c8c96" }}>
          Click any entity to view details
        </div>
      </div>

      {/* Tree card */}
      <div style={{
        background: "#ffffff",
        borderRadius: 12,
        border: "1px solid #e8e6df",
        padding: 40,
        overflowX: "auto",
      }}>
        {tree.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8c8c96", fontSize: 14, padding: 32 }}>
            No entities found. Create entities with parent relationships to build the org chart.
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", gap: 40 }}>
            {tree.map((root) => (
              <Node key={root.id} node={root} />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        marginTop: 24,
        display: "flex",
        alignItems: "center",
        gap: 20,
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, color: "#8c8c96", fontWeight: 500 }}>Entity Types:</span>
        {LEGEND_TYPES.map((t) => {
          const colors = EC[t.key] || EC.other;
          return (
            <span key={t.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                border: `1.5px solid ${colors.border}`,
                background: colors.bg,
              }} />
              <span style={{ fontSize: 12, color: "#6b6b76" }}>{t.label}</span>
            </span>
          );
        })}

        <span style={{ width: 1, height: 14, background: "#ddd9d0", margin: "0 4px" }} />

        <span style={{ fontSize: 12, color: "#8c8c96", fontWeight: 500 }}>Filing Status:</span>
        {Object.entries(FILING_STATUS_CONFIG).map(([key, cfg]) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Dot color={cfg.color} size={6} />
            <span style={{ fontSize: 12, color: "#6b6b76" }}>{cfg.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
