"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Dot } from "@/components/ui/dot";
import { LinkIcon } from "@/components/ui/icons";
import { ENTITY_TYPE_LABELS } from "@/lib/utils/entity-colors";
import { useIsMobile } from "@/hooks/use-mobile";

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

function Node({ node, isMobile }: { node: TreeNode; isMobile: boolean }) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  const colors = EC[node.type] || EC.other;
  const filingConfig = FILING_STATUS_CONFIG[node.filing_status] || FILING_STATUS_CONFIG.current;
  const typeLabel = ENTITY_TYPE_LABELS[node.type as keyof typeof ENTITY_TYPE_LABELS] || node.type;

  const handleClick = useCallback(() => {
    router.push(`/entities/${node.id}`);
  }, [router, node.id]);

  const nodeMinWidth = isMobile ? 140 : 210;
  const nodePadding = isMobile ? "10px 12px" : "14px 20px";
  const nameFontSize = isMobile ? 11 : 13;
  const typeFontSize = isMobile ? 10 : 11;
  const detailFontSize = isMobile ? 10 : 11;
  const connectorHeight = isMobile ? 16 : 24;
  const childGap = isMobile ? 10 : 20;

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
          borderRadius: isMobile ? 8 : 12,
          padding: nodePadding,
          minWidth: nodeMinWidth,
          minHeight: isMobile ? 44 : undefined,
          cursor: "pointer",
          textAlign: "center",
          transition: "all 0.15s",
          transform: hovered ? "translateY(-2px)" : "translateY(0)",
          boxShadow: hovered ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
        }}
      >
        {/* Entity name */}
        <div style={{ fontSize: nameFontSize, fontWeight: 600, color: "#1a1a1a", marginBottom: isMobile ? 2 : 4 }}>
          {node.name}
        </div>

        {/* Entity type */}
        <div style={{ fontSize: typeFontSize, fontWeight: 500, color: colors.text, marginBottom: isMobile ? 3 : 6 }}>
          {typeLabel}
        </div>

        {/* Formation state + additional registrations */}
        <div style={{ fontSize: detailFontSize, color: "#8c8c96", marginBottom: isMobile ? 3 : 6 }}>
          {node.formation_state}
          {node.additional_reg_count > 0 && (
            <span style={{ marginLeft: 4, color: "#a0a0a8" }}>
              +{node.additional_reg_count}
            </span>
          )}
        </div>

        {/* Filing status + relationships row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: isMobile ? 6 : 10 }}>
          {/* Filing status */}
          <span style={{ display: "flex", alignItems: "center", gap: isMobile ? 3 : 4 }}>
            <Dot color={filingConfig.color} size={6} />
            <span style={{ fontSize: detailFontSize, fontWeight: 500, color: filingConfig.color }}>
              {filingConfig.symbol}
            </span>
          </span>

          {/* Relationship count */}
          {node.relationship_count > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, color: "#8c8c96" }}>
              <LinkIcon size={isMobile ? 10 : 11} />
              <span style={{ fontSize: detailFontSize }}>{node.relationship_count}</span>
            </span>
          )}
        </div>
      </div>

      {/* Children */}
      {node.children.length > 0 && (
        <>
          {/* Vertical connector from parent to horizontal line */}
          <div style={{ width: 1.5, height: connectorHeight, background: "#ddd9d0" }} />

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
                  width: `calc(100% - ${nodeMinWidth}px)`,
                  minWidth: 20,
                }}
              />
            )}

            <div style={{ display: "flex", gap: childGap }}>
              {node.children.map((child) => (
                <div key={child.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  {/* Vertical connector from horizontal line to child */}
                  <div style={{ width: 1.5, height: connectorHeight, background: "#ddd9d0" }} />
                  <Node node={child} isMobile={isMobile} />
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
  const isMobile = useIsMobile();

  // Touch-based panning for mobile
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  // Shared mobile container height: viewport minus header (48px) and bottom tab bar (~60px)
  const mobileContainerHeight = "calc(100vh - 48px - 60px)";

  if (loading) {
    return (
      <div style={{ padding: isMobile ? 16 : 32 }}>
        <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
          Organization Chart
        </div>
        <div style={{ fontSize: isMobile ? 12 : 13, color: "#8c8c96", marginBottom: isMobile ? 16 : 24 }}>
          {isMobile ? "Tap any entity to view details" : "Click any entity to view details"}
        </div>
        <div style={{
          background: "#ffffff", borderRadius: 12, border: "1px solid #e8e6df",
          padding: isMobile ? 32 : 48, textAlign: "center", color: "#8c8c96", fontSize: 14,
          ...(isMobile ? { minHeight: mobileContainerHeight, display: "flex", alignItems: "center", justifyContent: "center" } : {}),
        }}>
          Loading...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: isMobile ? 16 : 32 }}>
        <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 600, color: "#1a1a1a", marginBottom: 4 }}>
          Organization Chart
        </div>
        <div style={{ fontSize: isMobile ? 12 : 13, color: "#8c8c96", marginBottom: isMobile ? 16 : 24 }}>
          {isMobile ? "Tap any entity to view details" : "Click any entity to view details"}
        </div>
        <div style={{
          background: "#ffffff", borderRadius: 12, border: "1px solid #e8e6df",
          padding: isMobile ? 32 : 48, textAlign: "center", color: "#c73e3e", fontSize: 14,
          ...(isMobile ? { minHeight: mobileContainerHeight, display: "flex", alignItems: "center", justifyContent: "center" } : {}),
        }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: isMobile ? 16 : 32,
      ...(isMobile ? { display: "flex", flexDirection: "column" as const, height: mobileContainerHeight, overflow: "hidden" } : {}),
    }}>
      {/* Header */}
      <div style={{ marginBottom: isMobile ? 12 : 24, flexShrink: 0 }}>
        <div style={{
          display: "flex",
          flexDirection: isMobile ? "column" as const : "row" as const,
          alignItems: isMobile ? "flex-start" : "baseline",
          gap: isMobile ? 2 : 8,
        }}>
          <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 600, color: "#1a1a1a" }}>
            Organization Chart
          </div>
          <div style={{ fontSize: isMobile ? 12 : 13, color: "#8c8c96" }}>
            {isMobile ? "Tap any entity to view details" : "Click any entity to view details"}
          </div>
        </div>
      </div>

      {/* Tree card - scrollable/pannable on mobile */}
      <div
        ref={scrollContainerRef}
        style={{
          background: "#ffffff",
          borderRadius: 12,
          border: "1px solid #e8e6df",
          padding: isMobile ? 16 : 40,
          overflowX: "auto",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          ...(isMobile ? {
            flex: 1,
            minHeight: 0,
          } : {}),
        }}
      >
        {tree.length === 0 ? (
          <div style={{ textAlign: "center", color: "#8c8c96", fontSize: isMobile ? 13 : 14, padding: isMobile ? 16 : 32 }}>
            No entities found. Create entities with parent relationships to build the org chart.
          </div>
        ) : (
          <div style={{
            display: "inline-flex",
            justifyContent: "center",
            gap: isMobile ? 20 : 40,
            minWidth: "100%",
            paddingBottom: isMobile ? 16 : 0,
          }}>
            {tree.map((root) => (
              <Node key={root.id} node={root} isMobile={isMobile} />
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{
        marginTop: isMobile ? 12 : 24,
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 10 : 20,
        flexWrap: "wrap",
        flexShrink: 0,
        ...(isMobile ? { paddingBottom: 8 } : {}),
      }}>
        <span style={{ fontSize: isMobile ? 11 : 12, color: "#8c8c96", fontWeight: 500 }}>Entity Types:</span>
        {LEGEND_TYPES.map((t) => {
          const colors = EC[t.key] || EC.other;
          return (
            <span key={t.key} style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 6 }}>
              <span style={{
                width: isMobile ? 8 : 10,
                height: isMobile ? 8 : 10,
                borderRadius: 3,
                border: `1.5px solid ${colors.border}`,
                background: colors.bg,
              }} />
              <span style={{ fontSize: isMobile ? 11 : 12, color: "#6b6b76" }}>{t.label}</span>
            </span>
          );
        })}

        {!isMobile && (
          <span style={{ width: 1, height: 14, background: "#ddd9d0", margin: "0 4px" }} />
        )}

        {isMobile && <div style={{ width: "100%" }} />}

        <span style={{ fontSize: isMobile ? 11 : 12, color: "#8c8c96", fontWeight: 500 }}>Filing Status:</span>
        {Object.entries(FILING_STATUS_CONFIG).map(([key, cfg]) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Dot color={cfg.color} size={6} />
            <span style={{ fontSize: isMobile ? 11 : 12, color: "#6b6b76" }}>{cfg.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
