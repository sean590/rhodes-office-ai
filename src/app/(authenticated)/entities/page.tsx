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
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
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
  doc_completion: { total: number; satisfied: number };
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

/* Table styles (stable references — avoids re-creation on every render) */
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function EntitiesPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [entities, setEntities] = useState<EntityListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  /* Fetch entities on mount */
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch("/api/entities", { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to fetch entities");
        const data = await res.json();
        setEntities(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, []);

  const setPageContext = useSetPageContext();
  useEffect(() => {
    setPageContext({ page: "entities_list" });
    return () => setPageContext(null);
  }, [setPageContext]);

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
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: "space-between", alignItems: isMobile ? "stretch" : "flex-start", gap: isMobile ? 12 : 0 }}>
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

      {/* ---- Table / Cards ---- */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>
              {search ? "No entities match your search." : "No entities found."}
            </div>
          ) : (
            filtered.map((entity) => {
              const typeColor = ENTITY_TYPE_COLORS[entity.type] ?? ENTITY_TYPE_COLORS.other;
              const typeLabel = ENTITY_TYPE_LABELS[entity.type] ?? entity.type;
              const filingColor = FILING_STATUS_COLORS[entity.filing_status] ?? "#9494a0";
              const filingLabel = FILING_STATUS_LABELS[entity.filing_status] ?? entity.filing_status;
              const { total, satisfied } = entity.doc_completion ?? { total: 0, satisfied: 0 };
              const pct = total > 0 ? Math.round((satisfied / total) * 100) : 0;
              const docColor = total === 0 ? "#9494a0" : pct === 100 ? "#2d8a4e" : pct >= 50 ? "#a68b1a" : "#c73e3e";

              return (
                <div
                  key={entity.id}
                  onClick={() => router.push(`/entities/${entity.id}`)}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #e8e6df",
                    borderRadius: 10,
                    padding: "14px 16px",
                    cursor: "pointer",
                  }}
                >
                  {/* Name + type badge */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1f" }}>
                      {entity.name}
                    </div>
                    <Badge label={typeLabel} color={typeColor.text} bg={typeColor.bg} />
                  </div>

                  {/* Managers */}
                  {entity.managers.length > 0 && (
                    <div style={{ fontSize: 12, color: "#9494a0", marginTop: 4 }}>
                      {entity.managers.map((m) => m.name).join(", ")}
                    </div>
                  )}

                  {/* EIN + Doc completion */}
                  <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "#1a1a1f", alignItems: "center" }}>
                    <span style={{ fontFamily: "'DM Mono', monospace" }}>
                      {maskEin(entity.ein)}
                    </span>
                    {total > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div
                          style={{
                            width: 36,
                            height: 5,
                            borderRadius: 3,
                            background: "#e8e6df",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              borderRadius: 3,
                              background: docColor,
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 11, color: docColor, fontWeight: 500 }}>
                          {satisfied}/{total}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Filing status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                    <Dot color={filingColor} />
                    <span style={{ fontSize: 12, color: filingColor, fontWeight: 500 }}>
                      {filingLabel}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
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
                <th style={thStyle}>EIN</th>
                <th style={thStyle}>Docs</th>
                <th style={thStyle}>Filing Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 32, textAlign: "center", color: "#9494a0", fontSize: 13 }}>
                    {search ? "No entities match your search." : "No entities found."}
                  </td>
                </tr>
              ) : (
                filtered.map((entity) => {
                  const typeColor = ENTITY_TYPE_COLORS[entity.type] ?? ENTITY_TYPE_COLORS.other;
                  const typeLabel = ENTITY_TYPE_LABELS[entity.type] ?? entity.type;
                  const filingColor = FILING_STATUS_COLORS[entity.filing_status] ?? "#9494a0";
                  const filingLabel = FILING_STATUS_LABELS[entity.filing_status] ?? entity.filing_status;
                  const { total, satisfied } = entity.doc_completion ?? { total: 0, satisfied: 0 };
                  const pct = total > 0 ? Math.round((satisfied / total) * 100) : 0;
                  const docColor = total === 0 ? "#9494a0" : pct === 100 ? "#2d8a4e" : pct >= 50 ? "#a68b1a" : "#c73e3e";

                  return (
                    <tr
                      key={entity.id}
                      onClick={() => router.push(`/entities/${entity.id}`)}
                      className="row-hover"
                      style={{ cursor: "pointer" }}
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

                      {/* Document completion */}
                      <td style={tdStyle}>
                        {total === 0 ? (
                          <span style={{ fontSize: 12, color: "#9494a0" }}>&mdash;</span>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div
                              style={{
                                width: 48,
                                height: 6,
                                borderRadius: 3,
                                background: "#e8e6df",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  width: `${pct}%`,
                                  height: "100%",
                                  borderRadius: 3,
                                  background: docColor,
                                  transition: "width 0.3s ease",
                                }}
                              />
                            </div>
                            <span style={{ fontSize: 12, color: docColor, fontWeight: 500, minWidth: 32 }}>
                              {satisfied}/{total}
                            </span>
                          </div>
                        )}
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
      )}
    </div>
  );
}
