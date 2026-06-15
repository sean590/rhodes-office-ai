"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INVESTMENT_TYPE_COLORS, INVESTMENT_TYPE_LABELS, INVESTMENT_STATUS_COLORS, INVESTMENT_STATUS_LABELS } from "@/lib/utils/investment-colors";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSetPageContext } from "@/components/chat/page-context-provider";
import { AllocationsTab } from "@/components/investments/AllocationsTab";
import { TransactionsTab } from "@/components/investments/TransactionsTab";
import { DocumentsTab } from "@/components/investments/DocumentsTab";
import { humanizeActivity } from "@/lib/activity-humanizer";
import type { InvestmentType, InvestmentStatus, InvestmentInvestor, CoInvestor } from "@/lib/types/investments";

interface InvestmentDetail {
  id: string;
  name: string;
  short_name: string | null;
  investment_type: InvestmentType;
  status: InvestmentStatus;
  entity_id: string | null;
  description: string | null;
  formation_state: string | null;
  date_invested: string | null;
  date_exited: string | null;
  preferred_return_pct: number | null;
  preferred_return_basis: string | null;
  investors: InvestmentInvestor[];
  co_investors: CoInvestor[];
  participant_count: number;
  total_committed: number;
  total_contributed: number;
  total_distributed: number;
  // Spec 036
  called_capital: number;
  uncalled_capital: number;
  total_distributed_gross: number;
  total_distributed_net: number;
}

function fmtDollarsFull(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const TABS = [
  { id: "allocations", label: "Allocations" },
  { id: "transactions", label: "Transactions" },
  { id: "documents", label: "Documents" },
  { id: "activity", label: "Activity" },
];

export default function InvestmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [investment, setInvestment] = useState<InvestmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("allocations");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editPrefReturnPct, setEditPrefReturnPct] = useState("");
  const [editPrefReturnBasis, setEditPrefReturnBasis] = useState("");
  const [editDescription, setEditDescription] = useState("");
  // (Investor editing was moved to the Ownership table's Edit Investors panel
  // in AllocationsTab — these state slots used to back a top-level form.)

  // Activity state
  const [activityLog, setActivityLog] = useState<Array<{
    id: string; action: string; resource_type: string;
    metadata: Record<string, unknown>; user_name: string | null; created_at: string;
  }>>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const fetchInvestment = useCallback(async () => {
    try {
      const res = await fetch(`/api/investments/${id}`);
      if (res.ok) setInvestment(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchInvestment(); }, [fetchInvestment]);

  useEffect(() => {
    if (activeTab !== "activity") return;
    setActivityLoading(true);
    fetch(`/api/audit?investment_id=${id}&limit=50`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setActivityLog(data))
      .catch(console.error)
      .finally(() => setActivityLoading(false));
  }, [activeTab, id]);

  const setPageContext = useSetPageContext();
  useEffect(() => {
    if (investment) setPageContext({ page: "investment_detail", investmentId: id, investmentName: investment.name });
    return () => setPageContext(null);
  }, [setPageContext, investment, id]);

  const startEditing = () => {
    if (!investment) return;
    setEditName(investment.name);
    setEditStatus(investment.status);
    setEditPrefReturnPct(investment.preferred_return_pct != null ? String(investment.preferred_return_pct) : "");
    setEditPrefReturnBasis(investment.preferred_return_basis || "");
    setEditDescription(investment.description || "");
    setEditing(true);
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/investments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName, status: editStatus,
          preferred_return_pct: editPrefReturnPct ? Number(editPrefReturnPct) : null,
          preferred_return_basis: editPrefReturnBasis || null,
          description: editDescription || null,
        }),
      });
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to save"); setSaving(false); return; }

      // Investor + co-investor edits live in the Ownership table's
      // "Edit Investors" panel (AllocationsTab) — kept out of the top-level
      // Edit form so there's a single source of truth for the investor list.

      setEditing(false);
      fetchInvestment();
    } catch (err) { console.error(err); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/investments/${id}`, { method: "DELETE" });
      if (res.ok) router.push("/investments");
      else { const err = await res.json(); alert(err.error || "Failed to delete"); }
    } catch (err) { console.error(err); }
  };

  if (loading) return <div style={{ maxWidth: 1200, margin: "0 auto" }}><div style={{ color: "var(--faint)", fontSize: 13 }}>Loading...</div></div>;
  if (!investment) return <div style={{ maxWidth: 1200, margin: "0 auto" }}><div style={{ color: "var(--red)", fontSize: 14 }}>Investment not found.</div></div>;

  const typeColor = INVESTMENT_TYPE_COLORS[investment.investment_type] || INVESTMENT_TYPE_COLORS.other;
  const statusColor = INVESTMENT_STATUS_COLORS[investment.status] || INVESTMENT_STATUS_COLORS.active;
  // Spec 036:
  //  - "Called" comes from line_items.subscription, NOT total_contributed
  //  - "Cash Invested" is the new label for total_contributed (includes fees)
  //  - "Uncalled" = committed - called
  const calledCapital = investment.called_capital ?? investment.total_contributed;
  const uncalled = investment.total_committed > 0 ? Math.max(0, investment.total_committed - calledCapital) : null;
  const calledPctOfCommitted = investment.total_committed > 0
    ? Math.round((calledCapital / investment.total_committed) * 100)
    : null;
  const net = investment.total_distributed - investment.total_contributed;
  const investorNames = investment.investors.map((inv) => inv.entity_name || "Unknown");

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <button onClick={() => router.push("/investments")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontSize: 13, padding: 0, marginBottom: 16 }}>
        &larr; Back to Investments
      </button>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink)", margin: 0 }}>{investment.name}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <Badge label={INVESTMENT_TYPE_LABELS[investment.investment_type]} color={typeColor.text} bg={typeColor.bg} />
              <Badge label={INVESTMENT_STATUS_LABELS[investment.status]} color={statusColor.text} bg={statusColor.bg} />
              {investorNames.length === 1 && (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  via{" "}
                  <button onClick={() => {
                    const inv = investment.investors[0];
                    if (inv) router.push(`/entities/${inv.entity_id}`);
                  }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--blue)", fontSize: 13, padding: 0 }}>
                    {investorNames[0]}
                  </button>
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 13, color: "var(--muted)", flexWrap: "wrap" }}>
              {investment.preferred_return_pct != null && (
                <span>Pref Return: {Number(investment.preferred_return_pct)}%{investment.preferred_return_basis ? ` (${investment.preferred_return_basis.replace(/_/g, " ")})` : ""}</span>
              )}
              {investment.date_invested && (
                <span>Invested: {new Date(investment.date_invested + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              )}
              {investment.formation_state && <span>State: {investment.formation_state}</span>}
            </div>
            {investment.co_investors && investment.co_investors.length > 0 && (
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                Co-investors: {investment.co_investors.map((c) => {
                  const name = c.directory_entry_name || "Unknown";
                  const pcts = [c.capital_pct != null ? `${c.capital_pct}% capital` : null, c.profit_pct != null ? `${c.profit_pct}% profit` : null].filter(Boolean).join(", ");
                  const role = c.role !== "co_investor" ? ` [${c.role}]` : "";
                  return `${name}${pcts ? ` (${pcts})` : ""}${role}`;
                }).join("; ")}
              </div>
            )}
            {investment.description && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6, maxWidth: 600, lineHeight: 1.5 }}>{investment.description}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent("rhodes:open-chat", { detail: { query: `Tell me about the ${investment.name} investment` } }));
              }}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "6px 12px", borderRadius: 7,
                border: "1px solid rgba(45,90,61,0.2)", background: "rgba(45,90,61,0.04)",
                cursor: "pointer", color: "var(--green)", fontSize: 13, fontWeight: 500,
              }}
            >
              Ask about this
            </button>
            <Button variant="secondary" onClick={startEditing}>Edit</Button>
            <button onClick={() => setShowDeleteConfirm(true)} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid var(--line)", background: "none", cursor: "pointer", color: "var(--red)", fontSize: 13, fontWeight: 500 }}>Delete</button>
          </div>
        </div>

        {showDeleteConfirm && (
          <div style={{ marginTop: 12, padding: "12px 16px", background: "rgba(199,62,62,0.06)", border: "1px solid rgba(199,62,62,0.2)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "var(--red)" }}>Delete this investment and all data?</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
              <button onClick={handleDelete} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: "var(--red)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Confirm Delete</button>
            </div>
          </div>
        )}

        {editing && (
          <div style={{ marginTop: 16, padding: 20, background: "var(--hover)", borderRadius: 10, border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Edit Investment</span>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                <Button variant="primary" onClick={saveEdits} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>Name</label>
                <input style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }} value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>Status</label>
                  <select style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid var(--line)", background: "#fff", cursor: "pointer" }} value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    <option value="active">Active</option>
                    <option value="committed">Committed</option>
                    <option value="winding_down">Winding Down</option>
                    <option value="exited">Exited</option>
                    <option value="defaulted">Defaulted</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>Preferred Return %</label>
                  <input type="number" style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid var(--line)", background: "#fff" }} value={editPrefReturnPct} onChange={(e) => setEditPrefReturnPct(e.target.value)} placeholder="0" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>Pref Return Basis</label>
                  <select style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid var(--line)", background: "#fff", cursor: "pointer" }} value={editPrefReturnBasis} onChange={(e) => setEditPrefReturnBasis(e.target.value)}>
                    <option value="">None</option>
                    <option value="capital_contributed">Capital Contributed</option>
                    <option value="capital_committed">Capital Committed</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>Description</label>
                <textarea style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid var(--line)", background: "#fff", minHeight: 60, resize: "vertical" }} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </div>
              <div style={{ fontSize: 12, color: "var(--faint)", padding: "8px 12px", background: "var(--hover)", borderRadius: 6 }}>
                Investors and co-investors are managed from the <strong>Edit Investors</strong> button on the Ownership table below.
              </div>
            </div>
          </div>
        )}

        {/* Summary stats — spec 036:
            Committed → Called → Uncalled → Cash Invested (total contributed
            including fees) → Distributed. */}
        <div style={{ display: "flex", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
          {[
            { label: "Participants", value: String(investment.participant_count) },
            ...(investment.total_committed > 0 ? [{ label: "Committed", value: fmtDollarsFull(investment.total_committed) }] : []),
            {
              label: "Called",
              value: fmtDollarsFull(calledCapital),
              sub: calledPctOfCommitted != null ? `${calledPctOfCommitted}% of committed` : null,
            },
            ...(uncalled != null ? [{ label: "Uncalled", value: fmtDollarsFull(uncalled) }] : []),
            { label: "Cash Invested", value: fmtDollarsFull(investment.total_contributed), sub: "incl. fees" },
            { label: "Distributed", value: fmtDollarsFull(investment.total_distributed) },
            { label: "Net cash position", value: fmtDollarsFull(net), valueColor: net < 0 ? "var(--red)" : "var(--green)" },
          ].map((stat: { label: string; value: string; sub?: string | null; valueColor?: string }) => (
            <div key={stat.label} style={{ background: "var(--hover)", borderRadius: 10, padding: "10px 18px", flex: isMobile ? "1 1 calc(50% - 8px)" : "0 0 auto" }}>
              <div style={{ fontSize: 11, color: "var(--faint)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{stat.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: stat.valueColor ?? "var(--ink)", marginTop: 2 }}>{stat.value}</div>
              {stat.sub && (
                <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 2 }}>{stat.sub}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--line)", marginBottom: 20 }}>
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: "10px 20px", background: "none", border: "none",
            borderBottom: activeTab === tab.id ? "2px solid var(--green)" : "2px solid transparent",
            color: activeTab === tab.id ? "var(--green)" : "var(--muted)",
            fontWeight: activeTab === tab.id ? 600 : 400, fontSize: 14, cursor: "pointer", transition: "all 0.15s",
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "allocations" && (
        <AllocationsTab
          investmentId={id}
          investors={investment.investors}
          coInvestors={investment.co_investors || []}
          preferredReturnPct={investment.preferred_return_pct}
          preferredReturnBasis={investment.preferred_return_basis}
          totalContributed={investment.total_contributed}
          isMobile={isMobile}
          onCoInvestorsChanged={fetchInvestment}
        />
      )}

      {activeTab === "transactions" && (
        <TransactionsTab investmentId={id} investors={investment.investors} isMobile={isMobile} onTransactionsChanged={fetchInvestment} />
      )}

      {activeTab === "documents" && (
        <DocumentsTab investmentId={id} isMobile={isMobile} />
      )}

      {activeTab === "activity" && (
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 16px", color: "var(--ink)" }}>Activity</h3>
          {activityLoading ? (
            <div style={{ color: "var(--faint)", fontSize: 13 }}>Loading activity...</div>
          ) : activityLog.length === 0 ? (
            <div style={{ color: "var(--faint)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>No activity recorded yet.</div>
          ) : (
            <div>
              {activityLog.map((entry) => {
                // Single source of truth — same humanized copy as Home → Done,
                // the entity Activity tab, and Settings (lib/activity-humanizer.ts).
                const human = humanizeActivity({ ...entry, investment_id: id });
                if (human.suppressed) return null;
                const title = human.lead;
                const detail = human.detail ?? "";

                const timeStr = new Date(entry.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

                return (
                  <div key={entry.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{title}</div>
                        {detail && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{detail}</div>}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>{timeStr}</div>
                        {entry.user_name && <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 1 }}>{entry.user_name}</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
