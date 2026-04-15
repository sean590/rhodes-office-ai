"use client";

import { useState, useCallback, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { PlusIcon, DocIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/utils/format";
import type { InvestmentAllocation, InvestmentTransaction, InvestmentTransactionType } from "@/lib/types/entities";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MemberOption {
  directory_entry_id: string;
  name: string;
}

interface InvestmentTabProps {
  entityId: string;
  entityName: string;
  parentEntityId: string | null;
  parentEntityName: string | null;
  isMobile: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtDollars(amount: number | null): string {
  if (amount === null || amount === undefined) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtDollarsFull(amount: number | null): string {
  if (amount === null || amount === undefined) return "$0.00";
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

const inputStyle: React.CSSProperties = {
  background: "#fafaf7",
  border: "1px solid #ddd9d0",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  color: "#1a1a1f",
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function InvestmentTab({ entityId, entityName, parentEntityId, parentEntityName, isMobile }: InvestmentTabProps) {
  const [allocations, setAllocations] = useState<InvestmentAllocation[]>([]);
  const [transactions, setTransactions] = useState<InvestmentTransaction[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit allocations state
  const [editingAllocations, setEditingAllocations] = useState(false);
  const [editAllocs, setEditAllocs] = useState<Array<{
    member_directory_id: string;
    member_name: string;
    allocation_pct: string;
    committed_amount: string;
    active: boolean;
  }>>([]);
  const [editEffectiveDate, setEditEffectiveDate] = useState("");
  const [allocSaving, setAllocSaving] = useState(false);

  // Add transaction state
  const [showAddTxn, setShowAddTxn] = useState(false);
  const [txnForm, setTxnForm] = useState({
    transaction_type: "distribution" as InvestmentTransactionType,
    amount: "",
    transaction_date: new Date().toISOString().split("T")[0],
    description: "",
    split_by_allocation: true,
  });
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [txnSaving, setTxnSaving] = useState(false);

  /* ---- Fetch ---- */
  const fetchAllocations = useCallback(async () => {
    if (!parentEntityId) return;
    try {
      const res = await fetch(`/api/entities/${entityId}/investment-allocations?parent_entity_id=${parentEntityId}`);
      if (res.ok) {
        const data = await res.json();
        setAllocations(data);
      }
    } catch (err) {
      console.error("Failed to load allocations:", err);
    }
  }, [entityId, parentEntityId]);

  const fetchTransactions = useCallback(async () => {
    if (!parentEntityId) return;
    try {
      const res = await fetch(`/api/entities/${entityId}/investment-transactions?parent_entity_id=${parentEntityId}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data);
      }
    } catch (err) {
      console.error("Failed to load transactions:", err);
    }
  }, [entityId, parentEntityId]);

  const fetchParentMembers = useCallback(async () => {
    if (!parentEntityId) return;
    try {
      const res = await fetch(`/api/entities/${parentEntityId}`);
      if (res.ok) {
        const data = await res.json();
        const m = (data.members || [])
          .filter((mem: { directory_entry_id: string | null }) => mem.directory_entry_id)
          .map((mem: { directory_entry_id: string; name: string }) => ({
            directory_entry_id: mem.directory_entry_id,
            name: mem.name,
          }));
        setMembers(m);
      }
    } catch (err) {
      console.error("Failed to load parent members:", err);
    }
  }, [parentEntityId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAllocations(), fetchTransactions(), fetchParentMembers()]).finally(() => setLoading(false));
  }, [fetchAllocations, fetchTransactions, fetchParentMembers]);

  /* ---- Computed values ---- */
  const totalAllocPct = allocations.reduce((sum, a) => sum + Number(a.allocation_pct), 0);
  const totalCommitted = allocations.reduce((sum, a) => sum + (Number(a.committed_amount) || 0), 0);

  // Sum contributions and distributions per member
  const memberTxns = transactions.filter((t) => t.member_directory_id !== null);
  const memberContributions: Record<string, number> = {};
  const memberDistributions: Record<string, number> = {};
  for (const t of memberTxns) {
    const mid = t.member_directory_id!;
    if (t.transaction_type === "contribution") {
      memberContributions[mid] = (memberContributions[mid] || 0) + Number(t.amount);
    } else {
      memberDistributions[mid] = (memberDistributions[mid] || 0) + Number(t.amount);
    }
  }
  const totalContributed = Object.values(memberContributions).reduce((a, b) => a + b, 0);
  const totalDistributed = Object.values(memberDistributions).reduce((a, b) => a + b, 0);

  // Parent-level transactions for history display (grouped)
  const parentTxns = transactions
    .filter((t) => t.member_directory_id === null)
    .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());

  // Child transactions grouped by parent_transaction_id
  const childTxnsByParent: Record<string, InvestmentTransaction[]> = {};
  for (const t of memberTxns) {
    if (t.parent_transaction_id) {
      if (!childTxnsByParent[t.parent_transaction_id]) childTxnsByParent[t.parent_transaction_id] = [];
      childTxnsByParent[t.parent_transaction_id].push(t);
    }
  }

  /* ---- Edit Allocations ---- */
  function startEditAllocations() {
    const allocs = members.map((m) => {
      const existing = allocations.find((a) => a.member_directory_id === m.directory_entry_id);
      return {
        member_directory_id: m.directory_entry_id,
        member_name: m.name,
        allocation_pct: existing ? String(Number(existing.allocation_pct)) : "",
        committed_amount: existing?.committed_amount ? String(Number(existing.committed_amount)) : "",
        active: existing ? existing.is_active : false,
      };
    });
    setEditAllocs(allocs);
    setEditEffectiveDate("");
    setEditingAllocations(true);
  }

  async function saveAllocations() {
    if (!parentEntityId) return;
    const active = editAllocs.filter((a) => a.active && Number(a.allocation_pct) > 0);
    const totalPct = active.reduce((sum, a) => sum + Number(a.allocation_pct || 0), 0);
    if (Math.abs(totalPct - 100) > 0.01) {
      alert(`Allocations must sum to 100% (currently ${totalPct.toFixed(2)}%)`);
      return;
    }

    setAllocSaving(true);
    try {
      const res = await fetch(`/api/entities/${entityId}/investment-allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_entity_id: parentEntityId,
          effective_date: editEffectiveDate || null,
          allocations: active.map((a) => ({
            member_directory_id: a.member_directory_id,
            allocation_pct: Number(a.allocation_pct),
            committed_amount: a.committed_amount ? Number(a.committed_amount) : null,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save allocations");
        return;
      }
      setEditingAllocations(false);
      await fetchAllocations();
    } catch (err) {
      console.error("Save allocations error:", err);
    } finally {
      setAllocSaving(false);
    }
  }

  /* ---- Add Transaction ---- */
  function computeSplitAmounts(totalAmount: number): Record<string, number> {
    const amounts: Record<string, number> = {};
    const active = allocations.filter((a) => a.is_active);
    // Compute each member's share, then adjust first member for rounding (matches server logic)
    for (const a of active) {
      amounts[a.member_directory_id] = Math.round((Number(a.allocation_pct) / 100) * totalAmount * 100) / 100;
    }
    const splitTotal = Object.values(amounts).reduce((s, v) => s + v, 0);
    const diff = Math.round((totalAmount - splitTotal) * 100) / 100;
    if (diff !== 0 && active.length > 0) {
      amounts[active[0].member_directory_id] = Math.round((amounts[active[0].member_directory_id] + diff) * 100) / 100;
    }
    return amounts;
  }

  async function saveTransaction() {
    if (!parentEntityId) return;
    const amount = Number(txnForm.amount);
    if (!amount || amount <= 0) {
      alert("Enter a valid amount");
      return;
    }

    setTxnSaving(true);
    try {
      const body: Record<string, unknown> = {
        parent_entity_id: parentEntityId,
        transaction_type: txnForm.transaction_type,
        amount,
        transaction_date: txnForm.transaction_date,
        description: txnForm.description || null,
      };

      if (txnForm.split_by_allocation) {
        body.split_by_allocation = true;
      } else {
        body.member_amounts = Object.entries(customAmounts)
          .filter(([, v]) => Number(v) > 0)
          .map(([mid, v]) => ({ member_directory_id: mid, amount: Number(v) }));
      }

      const res = await fetch(`/api/entities/${entityId}/investment-transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to save transaction");
        return;
      }
      setShowAddTxn(false);
      setTxnForm({
        transaction_type: "distribution",
        amount: "",
        transaction_date: new Date().toISOString().split("T")[0],
        description: "",
        split_by_allocation: true,
      });
      setCustomAmounts({});
      await fetchTransactions();
    } catch (err) {
      console.error("Save transaction error:", err);
    } finally {
      setTxnSaving(false);
    }
  }

  async function deleteTransaction(txnId: string) {
    if (!confirm("Delete this transaction and all member splits?")) return;
    try {
      const res = await fetch(`/api/entities/${entityId}/investment-transactions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: txnId }),
      });
      if (res.ok) await fetchTransactions();
    } catch (err) {
      console.error("Delete transaction error:", err);
    }
  }

  // Auto-compute split preview when amount changes
  const splitPreview = txnForm.split_by_allocation && Number(txnForm.amount) > 0
    ? computeSplitAmounts(Number(txnForm.amount))
    : null;

  /* ---- Loading ---- */
  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#9494a0" }}>Loading investment data...</div>;
  }

  if (!parentEntityId) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#9494a0" }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>No parent investment entity</div>
        <div style={{ fontSize: 12 }}>This entity needs to be linked as a deal to a parent investment entity to track allocations.</div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ---- Summary Stats ---- */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 16 }}>
        <StatBox label="Participants" value={String(allocations.length)} />
        <StatBox label="Total Committed" value={fmtDollars(totalCommitted)} />
        <StatBox label="Total Contributed" value={fmtDollars(totalContributed)} />
        <StatBox label="Total Distributed" value={fmtDollars(totalDistributed)} />
      </div>

      {/* ---- Allocation Table ---- */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <SectionHeader>
            Internal Allocations {parentEntityName ? `\u2014 ${parentEntityName}` : ""}
          </SectionHeader>
          {!editingAllocations && (
            <Button size="sm" onClick={startEditAllocations}>Edit</Button>
          )}
        </div>

        {editingAllocations ? (
          /* ---- Edit Mode ---- */
          <div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e8e6df" }}>
                    <th style={thStyle}></th>
                    <th style={{ ...thStyle, textAlign: "left" }}>Member</th>
                    <th style={thStyle}>Allocation %</th>
                    <th style={thStyle}>Committed $</th>
                  </tr>
                </thead>
                <tbody>
                  {editAllocs.map((a, i) => (
                    <tr key={a.member_directory_id} style={{ borderBottom: "1px solid #f0eee8" }}>
                      <td style={{ padding: "8px 6px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={a.active}
                          onChange={(e) => {
                            const next = [...editAllocs];
                            next[i] = { ...next[i], active: e.target.checked };
                            if (!e.target.checked) next[i].allocation_pct = "";
                            setEditAllocs(next);
                          }}
                          style={{ accentColor: "#2d5a3d" }}
                        />
                      </td>
                      <td style={{ padding: "8px 6px", color: a.active ? "#1a1a1f" : "#9494a0" }}>
                        {a.member_name}
                      </td>
                      <td style={{ padding: "8px 6px", width: 120 }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={a.allocation_pct}
                          disabled={!a.active}
                          onChange={(e) => {
                            const next = [...editAllocs];
                            next[i] = { ...next[i], allocation_pct: e.target.value };
                            setEditAllocs(next);
                          }}
                          style={{ ...inputStyle, width: 100, textAlign: "right", opacity: a.active ? 1 : 0.4 }}
                          placeholder="0.00"
                        />
                      </td>
                      <td style={{ padding: "8px 6px", width: 140 }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={a.committed_amount}
                          disabled={!a.active}
                          onChange={(e) => {
                            const next = [...editAllocs];
                            next[i] = { ...next[i], committed_amount: e.target.value };
                            setEditAllocs(next);
                          }}
                          style={{ ...inputStyle, width: 120, textAlign: "right", opacity: a.active ? 1 : 0.4 }}
                          placeholder="0.00"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "2px solid #e8e6df" }}>
                    <td></td>
                    <td style={{ padding: "8px 6px", fontWeight: 600, color: "#1a1a1f" }}>Total</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600 }}>
                      {(() => {
                        const total = editAllocs.filter((a) => a.active).reduce((s, a) => s + Number(a.allocation_pct || 0), 0);
                        const isValid = Math.abs(total - 100) <= 0.01;
                        return (
                          <span style={{ color: isValid ? "#2d5a3d" : "#c73e3e", fontFamily: "'DM Mono', monospace" }}>
                            {total.toFixed(2)}%
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>
                      {fmtDollarsFull(editAllocs.filter((a) => a.active).reduce((s, a) => s + Number(a.committed_amount || 0), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 12, color: "#6b6b76", fontWeight: 500 }}>Effective Date</label>
              <input
                type="date"
                value={editEffectiveDate}
                onChange={(e) => setEditEffectiveDate(e.target.value)}
                style={{ ...inputStyle, width: 160 }}
              />
            </div>

            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 8 }}>
              Allocations must sum to 100%. Unchecking a member deactivates their allocation.
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <Button variant="primary" onClick={saveAllocations} disabled={allocSaving}>
                {allocSaving ? "Saving..." : "Save Allocations"}
              </Button>
              <Button onClick={() => setEditingAllocations(false)}>Cancel</Button>
            </div>
          </div>
        ) : allocations.length === 0 ? (
          /* ---- Empty State ---- */
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 13, color: "#9494a0", marginBottom: 12 }}>
              No allocations set yet. Define how the parent entity&apos;s ownership is split among its members for this deal.
            </div>
            <Button variant="primary" onClick={startEditAllocations}>
              <PlusIcon size={10} /> Set Allocations
            </Button>
          </div>
        ) : (
          /* ---- Read-Only Table ---- */
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e8e6df" }}>
                  <th style={{ ...thStyle, textAlign: "left" }}>Member</th>
                  <th style={thStyle}>Allocation</th>
                  <th style={thStyle}>Committed</th>
                  <th style={thStyle}>Contributed</th>
                  <th style={thStyle}>Distributed</th>
                  <th style={thStyle}>Net</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => {
                  const contributed = memberContributions[a.member_directory_id] || 0;
                  const distributed = memberDistributions[a.member_directory_id] || 0;
                  const net = distributed - contributed;
                  return (
                    <tr key={a.id} style={{ borderBottom: "1px solid #f0eee8" }}>
                      <td style={{ padding: "10px 6px", color: "#1a1a1f", fontWeight: 500 }}>{a.member_name}</td>
                      <td style={tdRight}>{Number(a.allocation_pct).toFixed(2)}%</td>
                      <td style={tdRight}>{a.committed_amount ? fmtDollarsFull(Number(a.committed_amount)) : "\u2014"}</td>
                      <td style={tdRight}>{contributed > 0 ? fmtDollarsFull(contributed) : "\u2014"}</td>
                      <td style={tdRight}>{distributed > 0 ? fmtDollarsFull(distributed) : "\u2014"}</td>
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
                  <td style={{ ...tdRight, fontWeight: 600 }}>{totalAllocPct.toFixed(2)}%</td>
                  <td style={{ ...tdRight, fontWeight: 600 }}>{totalCommitted > 0 ? fmtDollarsFull(totalCommitted) : "\u2014"}</td>
                  <td style={{ ...tdRight, fontWeight: 600 }}>{totalContributed > 0 ? fmtDollarsFull(totalContributed) : "\u2014"}</td>
                  <td style={{ ...tdRight, fontWeight: 600 }}>{totalDistributed > 0 ? fmtDollarsFull(totalDistributed) : "\u2014"}</td>
                  <td style={{ ...tdRight, fontWeight: 600, color: totalDistributed - totalContributed >= 0 ? "#2d5a3d" : "#c73e3e" }}>
                    {(() => {
                      const net = totalDistributed - totalContributed;
                      return net === 0 ? "\u2014" : (net > 0 ? "+" : "") + fmtDollarsFull(net);
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
            <div style={{ fontSize: 11, color: "#9494a0", marginTop: 8 }}>
              Allocations are internal to {parentEntityName || "the parent entity"}. Legal ownership is shown on the Cap Table tab.
            </div>
          </div>
        )}
      </Card>

      {/* ---- Transaction History ---- */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <SectionHeader>Transaction History</SectionHeader>
          {allocations.length > 0 && !showAddTxn && (
            <Button variant="primary" onClick={() => setShowAddTxn(true)}>
              <PlusIcon size={10} /> Add Transaction
            </Button>
          )}
        </div>

        {/* ---- Add Transaction Form ---- */}
        {showAddTxn && (
          <div style={{ background: "#fafaf7", border: "1px solid #e8e6df", borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", marginBottom: 16 }}>
              Add Transaction
            </div>

            {/* Type selector */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {(["contribution", "distribution", "return_of_capital"] as InvestmentTransactionType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTxnForm((f) => ({ ...f, transaction_type: t }))}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    border: txnForm.transaction_type === t ? `1px solid ${TXN_TYPE_COLORS[t].color}` : "1px solid #ddd9d0",
                    background: txnForm.transaction_type === t ? TXN_TYPE_COLORS[t].bg : "#fff",
                    color: txnForm.transaction_type === t ? TXN_TYPE_COLORS[t].color : "#6b6b76",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {TXN_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Amount + Date row */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Total Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={txnForm.amount}
                  onChange={(e) => setTxnForm((f) => ({ ...f, amount: e.target.value }))}
                  style={inputStyle}
                  placeholder="50000.00"
                />
              </div>
              <div>
                <label style={labelStyle}>Date</label>
                <input
                  type="date"
                  value={txnForm.transaction_date}
                  onChange={(e) => setTxnForm((f) => ({ ...f, transaction_date: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Description */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Description</label>
              <input
                type="text"
                value={txnForm.description}
                onChange={(e) => setTxnForm((f) => ({ ...f, description: e.target.value }))}
                style={inputStyle}
                placeholder="Q1 2026 distribution"
              />
            </div>

            {/* Split method */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Split Method</label>
              <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#1a1a1f" }}>
                  <input
                    type="radio"
                    checked={txnForm.split_by_allocation}
                    onChange={() => setTxnForm((f) => ({ ...f, split_by_allocation: true }))}
                    style={{ accentColor: "#2d5a3d" }}
                  />
                  Split by allocation %
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "#1a1a1f" }}>
                  <input
                    type="radio"
                    checked={!txnForm.split_by_allocation}
                    onChange={() => {
                      // Initialize custom amounts from allocation split
                      const preview = Number(txnForm.amount) > 0 ? computeSplitAmounts(Number(txnForm.amount)) : {};
                      const ca: Record<string, string> = {};
                      for (const a of allocations) {
                        ca[a.member_directory_id] = preview[a.member_directory_id]?.toFixed(2) || "";
                      }
                      setCustomAmounts(ca);
                      setTxnForm((f) => ({ ...f, split_by_allocation: false }));
                    }}
                    style={{ accentColor: "#2d5a3d" }}
                  />
                  Custom amounts
                </label>
              </div>
            </div>

            {/* Split preview / custom entry */}
            {Number(txnForm.amount) > 0 && allocations.length > 0 && (
              <div style={{ border: "1px solid #e8e6df", borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f5f4f0" }}>
                      <th style={{ ...thStyle, textAlign: "left", fontSize: 11 }}>Member</th>
                      <th style={{ ...thStyle, fontSize: 11 }}>Allocation</th>
                      <th style={{ ...thStyle, fontSize: 11 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((a) => (
                      <tr key={a.member_directory_id} style={{ borderBottom: "1px solid #f0eee8" }}>
                        <td style={{ padding: "6px 8px", color: "#1a1a1f" }}>{a.member_name}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", color: "#6b6b76" }}>{Number(a.allocation_pct).toFixed(2)}%</td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          {txnForm.split_by_allocation ? (
                            <span style={{ fontFamily: "'DM Mono', monospace", color: "#1a1a1f" }}>
                              {fmtDollarsFull(splitPreview?.[a.member_directory_id] ?? 0)}
                            </span>
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={customAmounts[a.member_directory_id] || ""}
                              onChange={(e) => setCustomAmounts((prev) => ({ ...prev, [a.member_directory_id]: e.target.value }))}
                              style={{ ...inputStyle, width: 110, textAlign: "right", padding: "4px 8px", fontSize: 12 }}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #e8e6df", background: "#f5f4f0" }}>
                      <td colSpan={2} style={{ padding: "6px 8px", fontWeight: 600, color: "#1a1a1f" }}>Total</td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>
                        {txnForm.split_by_allocation
                          ? fmtDollarsFull(Number(txnForm.amount))
                          : fmtDollarsFull(Object.values(customAmounts).reduce((s, v) => s + Number(v || 0), 0))
                        }
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="primary" onClick={saveTransaction} disabled={txnSaving}>
                {txnSaving ? "Saving..." : "Save Transaction"}
              </Button>
              <Button onClick={() => setShowAddTxn(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* ---- Transaction List ---- */}
        {parentTxns.length === 0 && !showAddTxn ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#9494a0", fontSize: 13 }}>
            No transactions recorded yet.
            {allocations.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Button variant="primary" onClick={() => setShowAddTxn(true)}>
                  <PlusIcon size={10} /> Add Transaction
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {parentTxns.map((txn) => {
              const children = childTxnsByParent[txn.id] || [];
              const typeColor = TXN_TYPE_COLORS[txn.transaction_type] || TXN_TYPE_COLORS.contribution;
              return (
                <div key={txn.id} style={{ padding: "14px 0", borderBottom: "1px solid #f0eee8" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, color: "#1a1a1f", fontWeight: 500 }}>
                          {formatDate(txn.transaction_date)}
                        </span>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 10,
                          color: typeColor.color,
                          background: typeColor.bg,
                        }}>
                          {TXN_TYPE_LABELS[txn.transaction_type]}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", fontFamily: "'DM Mono', monospace" }}>
                          {fmtDollarsFull(Number(txn.amount))}
                        </span>
                        {txn.document_id && (
                          <DocIcon size={14} />
                        )}
                      </div>
                      {txn.description && (
                        <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 4 }}>{txn.description}</div>
                      )}
                      {children.length > 0 && (
                        <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 6 }}>
                          Split: {children.map((c) => `${c.member_name} ${fmtDollars(Number(c.amount))}`).join(" \u00B7 ")}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteTransaction(txn.id)}
                      title="Delete transaction"
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#9494a0",
                        fontSize: 16,
                        padding: "2px 4px",
                        lineHeight: 1,
                      }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
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

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: "#6b6b76",
  marginBottom: 4,
};
