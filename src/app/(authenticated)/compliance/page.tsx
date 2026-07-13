"use client";

import { useState, useEffect, useCallback } from "react";

// Jurisdiction values come in as 2-letter state codes or the literal "federal".
// The rest of the app's state labels live in lib/constants but that's keyed on
// a Jurisdiction enum that doesn't include federal; simplest to title-case it
// here at the display boundary so the filter + row labels both read nicely.
function displayJurisdiction(j: string): string {
  if (j === "federal") return "Federal";
  return j;
}
interface ObligationRow {
  id: string;
  entity_id: string;
  entity_name: string | null;
  entity_type: string | null;
  rule_id: string | null;
  jurisdiction: string;
  obligation_type: string;
  name: string;
  description: string | null;
  frequency: string | null;
  next_due_date: string | null;
  status: string;
  completed_at: string | null;
  payment_amount: number | null;
  confirmation: string | null;
  notes: string | null;
  document_id: string | null;
  source: string | null;
}

interface Summary {
  overdue: number;
  due_this_month: number;
  upcoming: number;
  completed_this_year: number;
}

type StatusFilter = "all" | "overdue" | "due_soon" | "pending" | "completed" | "exempt";

export default function CompliancePage() {

  const [rows, setRows] = useState<ObligationRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ overdue: 0, due_this_month: 0, upcoming: 0, completed_this_year: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");
  const [entityStatusFilter, setEntityStatusFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (jurisdictionFilter) params.set("jurisdiction", jurisdictionFilter);
    if (entityStatusFilter !== "all") params.set("entity_status", entityStatusFilter);
    params.set("page", String(page));

    try {
      const res = await fetch(`/api/compliance?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.rows ?? []);
      setSummary(data.summary ?? { overdue: 0, due_this_month: 0, upcoming: 0, completed_this_year: 0 });
      setTotal(data.total ?? 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [statusFilter, jurisdictionFilter, entityStatusFilter, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const jurisdictions = Array.from(new Set(rows.map((r) => r.jurisdiction).filter(Boolean))).sort();

  // Group rows by entity.
  const grouped = new Map<string, { name: string; type: string | null; rows: ObligationRow[] }>();
  for (const r of rows) {
    const key = r.entity_id;
    if (!grouped.has(key)) grouped.set(key, { name: r.entity_name ?? "Unknown", type: r.entity_type, rows: [] });
    grouped.get(key)!.rows.push(r);
  }

  const today = new Date().toISOString().slice(0, 10);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkComplete = async () => {
    if (selectedIds.size === 0) return;
    setApplying(true);
    const completedAt = new Date().toISOString().slice(0, 10);
    for (const id of selectedIds) {
      await fetch(`/api/entities/${rows.find((r) => r.id === id)?.entity_id}/compliance/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed_at: completedAt }),
      }).catch(() => {});
    }
    setSelectedIds(new Set());
    setApplying(false);
    fetchData();
  };

  const handleBulkExempt = async () => {
    if (selectedIds.size === 0) return;
    const reason = prompt("Reason for exemption (optional):");
    setApplying(true);
    for (const id of selectedIds) {
      await fetch(`/api/entities/${rows.find((r) => r.id === id)?.entity_id}/compliance/${id}/exempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }).catch(() => {});
    }
    setSelectedIds(new Set());
    setApplying(false);
    fetchData();
  };

  const statusColor = (status: string, dueDate: string | null) => {
    if (status === "completed") return "#2d8a4e";
    if (status === "exempt" || status === "not_applicable") return "#9494a0";
    if (dueDate && dueDate < today) return "#c73e3e";
    return "#c47520";
  };

  const statusLabel = (status: string, dueDate: string | null) => {
    if (status === "completed") return "✓ Complete";
    if (status === "exempt") return "Exempt";
    if (status === "not_applicable") return "N/A";
    if (dueDate && dueDate < today) return "Overdue";
    return "Pending";
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Compliance</h1>
      <p style={{ color: "#6b6b76", fontSize: 13, marginBottom: 20 }}>
        Cross-entity compliance obligations for your organization.
      </p>

      {/* Summary bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Overdue", value: summary.overdue, color: "#c73e3e", bg: "#fdf2f2", filter: "overdue" as StatusFilter },
          { label: "Due this month", value: summary.due_this_month, color: "#c47520", bg: "#fef6e4", filter: "due_soon" as StatusFilter },
          { label: "Upcoming (90 days)", value: summary.upcoming, color: "#2d5a3d", bg: "#e8f5e9", filter: "pending" as StatusFilter },
          { label: "Completed this year", value: summary.completed_this_year, color: "#6b6b76", bg: "#f5f5f5", filter: "completed" as StatusFilter },
        ].map((card) => (
          <button
            key={card.label}
            onClick={() => { setStatusFilter(card.filter); setPage(1); }}
            style={{
              background: statusFilter === card.filter ? card.bg : "#fff",
              border: `1px solid ${statusFilter === card.filter ? card.color + "40" : "#e8e6df"}`,
              borderRadius: 10, padding: "14px 16px", cursor: "pointer",
              textAlign: "left", transition: "all 0.15s",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 2 }}>{card.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
          style={filterStyle}>
          <option value="all">All statuses</option>
          <option value="overdue">Overdue</option>
          <option value="due_soon">Due soon</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="exempt">Exempt</option>
        </select>
        <select value={jurisdictionFilter} onChange={(e) => { setJurisdictionFilter(e.target.value); setPage(1); }}
          style={filterStyle}>
          <option value="">All jurisdictions</option>
          {jurisdictions.map((j) => <option key={j} value={j}>{displayJurisdiction(j)}</option>)}
        </select>
        <select value={entityStatusFilter} onChange={(e) => { setEntityStatusFilter(e.target.value); setPage(1); }}
          style={filterStyle}>
          <option value="active">Active entities</option>
          <option value="all">All entities</option>
          <option value="inactive">Inactive</option>
          <option value="dissolved">Dissolved</option>
        </select>
        {selectedIds.size > 0 && (
          <>
            <button onClick={handleBulkComplete} disabled={applying}
              style={{ ...filterStyle, background: "#2d5a3d", color: "#fff", border: "none", cursor: "pointer" }}>
              {applying ? "..." : `Complete (${selectedIds.size})`}
            </button>
            <button onClick={handleBulkExempt} disabled={applying}
              style={{ ...filterStyle, background: "#6b6b76", color: "#fff", border: "none", cursor: "pointer" }}>
              Exempt ({selectedIds.size})
            </button>
          </>
        )}
      </div>

      {/* Obligation table grouped by entity */}
      {loading ? (
        <div style={{ color: "#6b6b76", padding: 20 }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#6b6b76", padding: 20, textAlign: "center" }}>
          No compliance obligations match the current filters.
        </div>
      ) : (
        <div style={{ border: "1px solid #e8e6df", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
          {Array.from(grouped.entries()).map(([entityId, group]) => {
            const overdueCount = group.rows.filter(
              (r) => r.status === "pending" && r.next_due_date && r.next_due_date < today,
            ).length;
            return (
              <div key={entityId}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 16px", background: "#f8f7f4", borderBottom: "1px solid #e8e6df",
                  fontSize: 14, fontWeight: 600, color: "#1a1a1f",
                }}>
                  <span>{group.name}</span>
                  {overdueCount > 0 && (
                    <span style={{ fontSize: 11, color: "#c73e3e", fontWeight: 500 }}>
                      {overdueCount} overdue
                    </span>
                  )}
                </div>
                {group.rows.map((r) => (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "8px 16px",
                    borderBottom: "1px solid #f0eee8", fontSize: 13,
                  }}>
                    <input type="checkbox" checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      disabled={r.status === "completed" || r.status === "exempt"} />
                    <span style={{ color: statusColor(r.status, r.next_due_date), fontSize: 16 }}>●</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>
                      {r.jurisdiction && <span style={{ color: "#6b6b76", fontWeight: 400 }}>{displayJurisdiction(r.jurisdiction)} </span>}
                      {r.name}
                    </span>
                    <span style={{ color: "#6b6b76", fontSize: 12, minWidth: 90 }}>
                      {r.next_due_date ? new Date(r.next_due_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 500, minWidth: 70, textAlign: "right",
                      color: statusColor(r.status, r.next_due_date),
                    }}>
                      {statusLabel(r.status, r.next_due_date)}
                    </span>
                    {r.payment_amount != null && (
                      <span style={{ fontSize: 12, color: "#6b6b76", minWidth: 60, textAlign: "right" }}>
                        ${Number(r.payment_amount).toLocaleString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 100 && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", justifyContent: "center" }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            style={{ fontSize: 12, padding: "4px 10px", border: "1px solid #d0d0d8", background: "#fff", borderRadius: 4, cursor: "pointer" }}>
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: "#6b6b76" }}>Page {page}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={rows.length < 100}
            style={{ fontSize: 12, padding: "4px 10px", border: "1px solid #d0d0d8", background: "#fff", borderRadius: 4, cursor: "pointer" }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

const filterStyle: React.CSSProperties = {
  fontSize: 13, padding: "6px 10px", borderRadius: 6,
  border: "1px solid #d0d0d8", background: "#fff",
};
