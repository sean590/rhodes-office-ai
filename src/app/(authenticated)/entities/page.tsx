"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { StatCard } from "@/components/ui/stat-card";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dot } from "@/components/ui/dot";
import { PlusIcon, AlertIcon } from "@/components/ui/icons";
import { ENTITY_TYPE_COLORS, ENTITY_TYPE_LABELS } from "@/lib/utils/entity-colors";
import { maskEin } from "@/lib/utils/format";
import { getStateLabel } from "@/lib/constants";
import type { EntityType } from "@/lib/types/enums";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EntityListItem {
  id: string;
  name: string;
  type: EntityType;
  status: string;
  ein: string | null;
  formation_state: string;
  formed_date: string | null;
  registrations: { id: string; jurisdiction: string; last_filing_date: string | null }[];
  managers: { id: string; name: string }[];
  members: { id: string; name: string; ref_entity_id: string | null }[];
  filing_status: "current" | "due_soon" | "overdue";
  relationship_count: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FILING_STATUS_COLORS: Record<string, string> = {
  current: "#2d8a4e",
  due_soon: "#a68b1a",
  overdue: "#c73e3e",
};

const FILING_STATUS_LABELS: Record<string, string> = {
  current: "Current",
  due_soon: "Due Soon",
  overdue: "Overdue",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getAllJurisdictions(entity: EntityListItem): string[] {
  const codes = new Set<string>();
  if (entity.formation_state) codes.add(entity.formation_state);
  entity.registrations.forEach((r) => codes.add(r.jurisdiction));
  return Array.from(codes);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EntitiesPage() {
  const router = useRouter();
  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  /* Fetch entities on mount */
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/entities");
        if (!res.ok) throw new Error("Failed to fetch entities");
        const data = await res.json();
        setEntities(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  /* Filtered list */
  const filtered = useMemo(() => {
    if (!search.trim()) return entities;
    const q = search.toLowerCase();
    return entities.filter((e) => {
      const typeLabel = ENTITY_TYPE_LABELS[e.type]?.toLowerCase() ?? "";
      const stateLabel = getStateLabel(e.formation_state as never).toLowerCase();
      return (
        e.name.toLowerCase().includes(q) ||
        typeLabel.includes(q) ||
        e.formation_state.toLowerCase().includes(q) ||
        stateLabel.includes(q)
      );
    });
  }, [entities, search]);

  /* Derived stats */
  const activeEntities = entities.filter((e) => e.status === "active");
  const uniqueJurisdictions = useMemo(() => {
    const codes = new Set<string>();
    entities.forEach((e) => getAllJurisdictions(e).forEach((c) => codes.add(c)));
    return codes.size;
  }, [entities]);

  const filingAlerts = useMemo(
    () => entities.filter((e) => e.filing_status === "due_soon" || e.filing_status === "overdue"),
    [entities],
  );

  const totalRelationships = useMemo(
    () => entities.reduce((sum, e) => sum + (e.relationship_count ?? 0), 0),
    [entities],
  );

  const overdueCount = filingAlerts.filter((e) => e.filing_status === "overdue").length;
  const dueSoonCount = filingAlerts.filter((e) => e.filing_status === "due_soon").length;

  /* Table column header style */
  const thStyle: React.CSSProperties = {
    padding: "10px 16px",
    textAlign: "left" as const,
    fontSize: 11,
    fontWeight: 600,
    color: "#9494a0",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    borderBottom: "1px solid #e8e6df",
  };

  const tdStyle: React.CSSProperties = {
    padding: "14px 16px",
    borderBottom: "1px solid #f0eee8",
    verticalAlign: "top" as const,
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f" }}>Entities</div>
        <div style={{ marginTop: 24, color: "#9494a0", fontSize: 13 }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      {/* ---- Header row ---- */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a1f", margin: 0 }}>Entities</h1>
          <div style={{ fontSize: 13, color: "#9494a0", marginTop: 2 }}>
            {activeEntities.length} active
          </div>
        </div>
        <Button variant="primary" onClick={() => router.push("/entities/new")}>
          <PlusIcon size={14} />
          New Entity
        </Button>
      </div>

      {/* ---- Filing alert banner ---- */}
      {filingAlerts.length > 0 && (
        <div
          style={{
            marginTop: 20,
            background: "rgba(250,204,21,0.08)",
            border: "1px solid rgba(250,204,21,0.25)",
            borderRadius: 10,
            padding: "12px 18px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <AlertIcon size={16} />
          <span style={{ fontSize: 13, color: "#1a1a1f" }}>
            {overdueCount > 0 && (
              <strong style={{ color: FILING_STATUS_COLORS.overdue }}>
                {overdueCount} overdue
              </strong>
            )}
            {overdueCount > 0 && dueSoonCount > 0 && " and "}
            {dueSoonCount > 0 && (
              <strong style={{ color: FILING_STATUS_COLORS.due_soon }}>
                {dueSoonCount} due soon
              </strong>
            )}
            {" "}filing{filingAlerts.length === 1 ? "" : "s"} require attention.
          </span>
        </div>
      )}

      {/* ---- Search bar ---- */}
      <div style={{ marginTop: 20, marginBottom: 14 }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by name, type, or state..."
        />
      </div>

      {/* ---- Table ---- */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #e8e6df",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Entity Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Formed In</th>
              <th style={thStyle}>Registered In</th>
              <th style={thStyle}>EIN</th>
              <th style={thStyle}>Filing Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>
                  {search ? "No entities match your search." : "No entities found."}
                </td>
              </tr>
            ) : (
              filtered.map((entity) => {
                const typeColor = ENTITY_TYPE_COLORS[entity.type] ?? ENTITY_TYPE_COLORS.other;
                const typeLabel = ENTITY_TYPE_LABELS[entity.type] ?? entity.type;
                const filingColor = FILING_STATUS_COLORS[entity.filing_status] ?? "#9494a0";
                const filingLabel = FILING_STATUS_LABELS[entity.filing_status] ?? entity.filing_status;
                const jurisdictions = getAllJurisdictions(entity);

                return (
                  <tr
                    key={entity.id}
                    onClick={() => router.push(`/entities/${entity.id}`)}
                    style={{ cursor: "pointer", transition: "background 0.15s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fafaf7")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Entity name + managers */}
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 500, fontSize: 14, color: "#1a1a1f" }}>
                        {entity.name}
                      </div>
                      {entity.managers.length > 0 && (
                        <div style={{ fontSize: 11, color: "#9494a0", marginTop: 2 }}>
                          {entity.managers.map((m) => m.name).join(", ")}
                        </div>
                      )}
                    </td>

                    {/* Type badge */}
                    <td style={tdStyle}>
                      <Badge label={typeLabel} color={typeColor.text} bg={typeColor.bg} />
                    </td>

                    {/* Formed In */}
                    <td style={{ ...tdStyle, fontSize: 13, color: "#1a1a1f" }}>
                      {entity.formation_state
                        ? getStateLabel(entity.formation_state as never)
                        : "\u2014"}
                    </td>

                    {/* Registered In */}
                    <td style={{ ...tdStyle, fontSize: 13, color: "#1a1a1f" }}>
                      {jurisdictions.length > 0 ? jurisdictions.join(", ") : "\u2014"}
                    </td>

                    {/* EIN (masked, mono font) */}
                    <td
                      style={{
                        ...tdStyle,
                        fontSize: 13,
                        color: "#1a1a1f",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {maskEin(entity.ein)}
                    </td>

                    {/* Filing status */}
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Dot color={filingColor} />
                        <span style={{ fontSize: 13, color: filingColor, fontWeight: 500 }}>
                          {filingLabel}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
