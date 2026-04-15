"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";
import type { InvestmentInvestor, CoInvestor } from "@/lib/types/investments";

interface Allocation {
  id: string;
  member_directory_id: string | null;
  member_entity_id?: string | null;
  member_name: string | null;
  allocation_pct: number;
  committed_amount: number | null;
  is_active: boolean;
}

interface Member {
  id: string;
  name: string;
  directory_entry_id: string | null;
  ref_entity_id: string | null;
}

interface EditAllocation {
  member_directory_id: string | null;
  member_entity_id: string | null;
  name: string;
  checked: boolean;
  allocation_pct: string;
  committed_amount: string;
}

interface Props {
  investmentId: string;
  investors: InvestmentInvestor[];
  coInvestors: CoInvestor[];
  preferredReturnPct: number | null;
  preferredReturnBasis: string | null;
  totalContributed: number;
  isMobile: boolean;
  onCoInvestorsChanged?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  co_investor: "Co-Investor",
  promoter: "Promoter",
  operator: "Operator",
  lender: "Lender",
};

function fmtDollars(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function AllocationsTab({ investmentId, investors, coInvestors, preferredReturnPct, preferredReturnBasis, totalContributed, isMobile, onCoInvestorsChanged }: Props) {
  // Track allocations per investor
  const [allocsByInvestor, setAllocsByInvestor] = useState<Record<string, Allocation[]>>({});
  const [membersByInvestor, setMembersByInvestor] = useState<Record<string, Member[]>>({});
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editingInvestorId, setEditingInvestorId] = useState<string | null>(null);
  const [editAllocations, setEditAllocations] = useState<EditAllocation[]>([]);

  // Combined investor editor state — manages both internal investors
  // (investment_investors / entities) and external co-investors
  // (investment_co_investors / directory_entries) in one panel, since the
  // user thinks of them together as "who's in this deal".
  const [editingInvestors, setEditingInvestors] = useState(false);
  const [editInternalInvestors, setEditInternalInvestors] = useState<Array<{
    id: string | null; entity_id: string; committed_capital: string; capital_pct: string; profit_pct: string;
  }>>([]);
  const [editCoInvestors, setEditCoInvestors] = useState<Array<{
    directory_entry_id: string | null; name: string; role: string; capital_pct: string; profit_pct: string; notes: string;
  }>>([]);
  const [directoryEntries, setDirectoryEntries] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [allEntities, setAllEntities] = useState<Array<{ id: string; name: string }>>([]);
  const [activeCoIdx, setActiveCoIdx] = useState<number | null>(null);

  const fetchAllocations = useCallback(async () => {
    const result: Record<string, Allocation[]> = {};
    for (const inv of investors) {
      try {
        const res = await fetch(`/api/investments/${investmentId}/allocations?investor_id=${inv.id}`);
        if (res.ok) result[inv.id] = await res.json();
        else result[inv.id] = [];
      } catch { result[inv.id] = []; }
    }
    setAllocsByInvestor(result);
    setLoading(false);
  }, [investmentId, investors]);

  const fetchMembers = useCallback(async () => {
    const result: Record<string, Member[]> = {};
    for (const inv of investors) {
      try {
        const res = await fetch(`/api/entities/${inv.entity_id}`);
        if (res.ok) {
          const entity = await res.json();
          result[inv.id] = (entity.members || []).map((m: { id: string; name: string; directory_entry_id: string | null; ref_entity_id: string | null }) => ({
            id: m.id, name: m.name,
            directory_entry_id: m.directory_entry_id || null,
            ref_entity_id: m.ref_entity_id || null,
          }));
        }
      } catch { /* skip */ }
    }
    setMembersByInvestor(result);
  }, [investors]);

  useEffect(() => {
    fetchAllocations();
    fetchMembers();
    fetch("/api/directory").then(r => r.ok ? r.json() : []).then(setDirectoryEntries).catch(() => {});
    fetch("/api/entities").then(r => r.ok ? r.json() : []).then((data) => {
      setAllEntities((data as Array<{ id: string; name: string }>).map(e => ({ id: e.id, name: e.name })));
    }).catch(() => {});
  }, [fetchAllocations, fetchMembers]);

  const startEditing = (investorId: string) => {
    const allocs = allocsByInvestor[investorId] || [];
    const members = membersByInvestor[investorId] || [];
    const allocMap = new Map(allocs.filter(a => a.member_entity_id).map(a => [a.member_entity_id as string, a]));
    const allocDirMap = new Map(allocs.filter(a => a.member_directory_id).map(a => [a.member_directory_id as string, a]));

    const editList: EditAllocation[] = [];
    const seenIds = new Set<string>();

    for (const member of members) {
      const key = member.ref_entity_id ? `entity:${member.ref_entity_id}` : member.directory_entry_id ? `dir:${member.directory_entry_id}` : `pending:${member.id}`;
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      const alloc = member.ref_entity_id ? allocMap.get(member.ref_entity_id) : member.directory_entry_id ? allocDirMap.get(member.directory_entry_id) : null;
      editList.push({
        member_directory_id: member.directory_entry_id || null,
        member_entity_id: member.ref_entity_id || null,
        name: alloc?.member_name || member.name,
        checked: !!alloc,
        allocation_pct: alloc ? String(Number(alloc.allocation_pct)) : "",
        committed_amount: alloc?.committed_amount != null ? String(alloc.committed_amount) : "",
      });
    }

    // Add any allocations not matched to members
    for (const alloc of allocs) {
      if (!alloc.member_entity_id && !alloc.member_directory_id) continue;
      const key = alloc.member_entity_id ? `entity:${alloc.member_entity_id}` : `dir:${alloc.member_directory_id}`;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        editList.push({
          member_directory_id: alloc.member_directory_id || null,
          member_entity_id: alloc.member_entity_id || null,
          name: alloc.member_name || "Unknown", checked: true,
          allocation_pct: String(Number(alloc.allocation_pct)),
          committed_amount: alloc.committed_amount != null ? String(alloc.committed_amount) : "",
        });
      }
    }

    setEditAllocations(editList);
    setEditingInvestorId(investorId);
  };

  const saveAllocations = async () => {
    if (!editingInvestorId) return;
    const active = editAllocations.filter(a => a.checked && Number(a.allocation_pct) > 0);
    const payload = active.map(a => {
      const p: Record<string, unknown> = {
        allocation_pct: Number(a.allocation_pct),
        committed_amount: a.committed_amount !== "" ? Number(a.committed_amount) : null,
      };
      if (a.member_entity_id) p.member_entity_id = a.member_entity_id;
      if (a.member_directory_id) p.member_directory_id = a.member_directory_id;
      return p;
    });

    try {
      const res = await fetch(`/api/investments/${investmentId}/allocations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ investor_id: editingInvestorId, allocations: payload }),
      });
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to save"); return; }
      setEditingInvestorId(null);
      fetchAllocations();
    } catch (err) { console.error(err); alert("Failed to save"); }
  };

  const totalPct = editAllocations.filter(a => a.checked).reduce((s, a) => s + (Number(a.allocation_pct) || 0), 0);
  const totalCommitted = editAllocations.filter(a => a.checked).reduce((s, a) => s + (Number(a.committed_amount) || 0), 0);

  // Investor contribution total for the investor being edited
  const editingInvestorContrib = editingInvestorId
    ? investors.find(i => i.id === editingInvestorId)
    : null;

  if (loading) return <div style={{ color: "#9494a0", fontSize: 13, padding: "20px 0" }}>Loading allocations...</div>;

  // === Ownership table ===
  // Derived capital % display: if every internal investor has a committed_capital
  // amount but no capital_pct, derive each one's share from $ / total $ so the
  // table is informative even before the user has filled in percentages.
  // Returns null if we can't derive (mixed data, no committed amounts, etc.).
  const allHaveCommitted = investors.length > 0 && investors.every(i => i.committed_capital != null);
  const noneHavePct = investors.every(i => i.capital_pct == null);
  const totalInternalCommitted = investors.reduce((s, i) => s + (Number(i.committed_capital) || 0), 0);
  const shouldDeriveCapPct = allHaveCommitted && noneHavePct && totalInternalCommitted > 0;
  const derivedCapPct = (inv: InvestmentInvestor): number | null => {
    if (!shouldDeriveCapPct) return null;
    return Math.round((Number(inv.committed_capital) / totalInternalCommitted) * 10000) / 100;
  };

  const totalCapital = investors.reduce((s, i) => {
    const pct = i.capital_pct != null ? Number(i.capital_pct) : (derivedCapPct(i) ?? 0);
    return s + pct;
  }, 0) + coInvestors.reduce((s, c) => s + (Number(c.capital_pct) || 0), 0);
  const totalProfit = investors.reduce((s, i) => s + (Number(i.profit_pct) || 0), 0) + coInvestors.reduce((s, c) => s + (Number(c.profit_pct) || 0), 0);
  const showProfit = investors.some(i => i.profit_pct != null) || coInvestors.some(c => c.profit_pct != null);
  const showCommitted = investors.some(i => i.committed_capital != null);
  const totalCommittedCapital = investors.reduce((s, i) => s + (Number(i.committed_capital) || 0), 0);
  const totalCalledCapital = investors.reduce((s, i) => s + (Number(i.called_capital) || 0), 0);

  return (
    <div>
      {/* Ownership table */}
      {(investors.length > 0 || coInvestors.length > 0) && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 12px" }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#1a1a1f" }}>Ownership</h3>
            {!editingInvestors && (
              <Button variant="secondary" onClick={() => {
                setEditInternalInvestors(investors.map(inv => ({
                  id: inv.id,
                  entity_id: inv.entity_id,
                  // committed_capital comes back as a DECIMAL — Supabase
                  // serializes it as a string like "516800.00". Round-trip
                  // through Number so the input shows "516800" instead.
                  committed_capital: inv.committed_capital != null ? String(Number(inv.committed_capital)) : "",
                  capital_pct: inv.capital_pct != null ? String(Number(inv.capital_pct)) : "",
                  profit_pct: inv.profit_pct != null ? String(Number(inv.profit_pct)) : "",
                })));
                setEditCoInvestors(coInvestors.map(ci => ({
                  directory_entry_id: ci.directory_entry_id,
                  name: ci.directory_entry_name || "",
                  role: ci.role || "co_investor",
                  capital_pct: ci.capital_pct != null ? String(ci.capital_pct) : "",
                  profit_pct: ci.profit_pct != null ? String(ci.profit_pct) : "",
                  notes: ci.notes || "",
                })));
                setEditingInvestors(true);
              }}>Edit Investors</Button>
            )}
          </div>
          {preferredReturnPct != null && (
            <div style={{ fontSize: 13, color: "#6b6b76", marginBottom: 12 }}>
              Preferred Return: {Number(preferredReturnPct)}%{preferredReturnBasis ? ` on ${preferredReturnBasis.replace(/_/g, " ")}` : ""}
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e8e6df" }}>Investor</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e8e6df" }}>Role</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e8e6df" }}>Capital %</th>
                {showProfit && <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e8e6df" }}>Profit %</th>}
                <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e8e6df" }}>Committed</th>
                <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e8e6df" }}>Called</th>
              </tr>
            </thead>
            <tbody>
              {investors.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", borderBottom: "1px solid #f0eee8" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{inv.entity_name || "Unknown"}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#2d5a3d", background: "rgba(45,90,61,0.10)", padding: "2px 7px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>Internal</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", borderBottom: "1px solid #f0eee8" }}>Investor</td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>
                    {inv.capital_pct != null
                      ? `${Number(inv.capital_pct)}%`
                      : derivedCapPct(inv) != null
                        ? `${derivedCapPct(inv)!.toFixed(2)}%`
                        : "—"}
                  </td>
                  {showProfit && <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>{inv.profit_pct != null ? `${Number(inv.profit_pct)}%` : "—"}</td>}
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>{inv.committed_capital != null ? fmtDollars(Number(inv.committed_capital)) : "—"}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>{inv.called_capital != null ? fmtDollars(inv.called_capital) : "—"}</td>
                </tr>
              ))}
              {coInvestors.map((ci) => (
                <tr key={ci.id}>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b6b76", borderBottom: "1px solid #f0eee8" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{ci.directory_entry_name || "Unknown"}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#6b3fa3", background: "rgba(123,77,181,0.10)", padding: "2px 7px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>External</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b6b76", borderBottom: "1px solid #f0eee8" }}>{ROLE_LABELS[ci.role] || ci.role}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b6b76", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>{ci.capital_pct != null ? `${Number(ci.capital_pct)}%` : "—"}</td>
                  {showProfit && <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b6b76", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>{ci.profit_pct != null ? `${Number(ci.profit_pct)}%` : "—"}</td>}
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b6b76", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>—</td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#6b6b76", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>—</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#1a1a1f", borderTop: "2px solid #ddd9d0" }}>Total</td>
                <td style={{ padding: "10px 12px", borderTop: "2px solid #ddd9d0" }}></td>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#1a1a1f", textAlign: "right", borderTop: "2px solid #ddd9d0" }}>{totalCapital.toFixed(2)}%</td>
                {showProfit && <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#1a1a1f", textAlign: "right", borderTop: "2px solid #ddd9d0" }}>{totalProfit.toFixed(2)}%</td>}
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#1a1a1f", textAlign: "right", borderTop: "2px solid #ddd9d0" }}>{totalCommittedCapital > 0 ? fmtDollars(totalCommittedCapital) : "—"}</td>
                <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#1a1a1f", textAlign: "right", borderTop: "2px solid #ddd9d0" }}>{totalCalledCapital > 0 ? fmtDollars(totalCalledCapital) : "—"}</td>
              </tr>
            </tbody>
          </table>

          {/* Unified Investors editor — dual section: Internal + External */}
          {editingInvestors && (
            <div style={{ marginTop: 16, background: "#f8f7f4", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#1a1a1f" }}>Edit Investors</h4>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" onClick={() => { setEditingInvestors(false); setActiveCoIdx(null); }}>Cancel</Button>
                  <Button variant="primary" onClick={async () => {
                    // Save internal investors via /investors (replace-all). Drop blank rows.
                    const internalPayload = editInternalInvestors
                      .filter(ei => ei.entity_id)
                      .map(ei => ({
                        entity_id: ei.entity_id,
                        committed_capital: ei.committed_capital ? Number(ei.committed_capital.replace(/,/g, "")) : null,
                        capital_pct: ei.capital_pct !== "" ? Number(ei.capital_pct) : null,
                        profit_pct: ei.profit_pct !== "" ? Number(ei.profit_pct) : null,
                      }));
                    if (internalPayload.length === 0) {
                      alert("At least one internal investor is required.");
                      return;
                    }
                    // Detect changes to skip a no-op POST.
                    const origInternal = investors.map(inv => ({
                      entity_id: inv.entity_id,
                      committed_capital: inv.committed_capital != null ? Number(inv.committed_capital) : null,
                      capital_pct: inv.capital_pct != null ? Number(inv.capital_pct) : null,
                      profit_pct: inv.profit_pct != null ? Number(inv.profit_pct) : null,
                    }));
                    const internalChanged = JSON.stringify(internalPayload) !== JSON.stringify(origInternal);

                    // Save external co-investors via /co-investors (replace-all).
                    const externalPayload = editCoInvestors
                      .filter(ci => ci.directory_entry_id)
                      .map(ci => ({
                        directory_entry_id: ci.directory_entry_id,
                        role: ci.role,
                        capital_pct: ci.capital_pct !== "" ? Number(ci.capital_pct) : null,
                        profit_pct: ci.profit_pct !== "" ? Number(ci.profit_pct) : null,
                        notes: ci.notes || null,
                      }));

                    try {
                      if (internalChanged) {
                        const res = await fetch(`/api/investments/${investmentId}/investors`, {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ investors: internalPayload }),
                        });
                        if (!res.ok) { const err = await res.json().catch(() => ({})); alert(err.error || "Failed to save investors"); return; }
                      }
                      const coRes = await fetch(`/api/investments/${investmentId}/co-investors`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ co_investors: externalPayload }),
                      });
                      if (!coRes.ok) { const err = await coRes.json().catch(() => ({})); alert(err.error || "Failed to save co-investors"); return; }
                      setEditingInvestors(false); setActiveCoIdx(null);
                      onCoInvestorsChanged?.();
                    } catch (err) { console.error(err); alert("Failed to save"); }
                  }}>Save</Button>
                </div>
              </div>

              {/* Internal Investors section */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h5 style={{ fontSize: 12, fontWeight: 600, margin: 0, color: "#1a1a1f", textTransform: "uppercase", letterSpacing: "0.06em" }}>Investors (Internal)</h5>
                  <span style={{ fontSize: 11, color: "#9494a0" }}>Entities you manage that hold an interest in the deal</span>
                </div>

                {editInternalInvestors.length === 0 && (
                  <div style={{ fontSize: 13, color: "#9494a0", padding: "8px 0" }}>No internal investors. At least one is required.</div>
                )}

                {editInternalInvestors.map((ei, i) => {
                  const inputStyle = { padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #ddd9d0", background: "#fff" };
                  return (
                    <div key={i} style={{ marginBottom: 8, background: "#fff", borderRadius: 8, padding: 10, border: "1px solid #e8e6df" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <select
                          style={{ ...inputStyle, flex: 2, cursor: "pointer" }}
                          value={ei.entity_id}
                          onChange={e => { const next = [...editInternalInvestors]; next[i] = { ...next[i], entity_id: e.target.value }; setEditInternalInvestors(next); }}
                        >
                          {!ei.entity_id && <option value="">Select an entity...</option>}
                          {allEntities.map(e => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                          ))}
                        </select>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                          <span style={{ fontSize: 12, color: "#9494a0" }}>$</span>
                          <input
                            type="text"
                            style={{ ...inputStyle, flex: 1, textAlign: "right" }}
                            value={ei.committed_capital}
                            onChange={e => {
                              const next = [...editInternalInvestors];
                              next[i] = { ...next[i], committed_capital: e.target.value };
                              // Auto-derive capital_pct from $ totals when every
                              // row has a non-zero $ amount. Mirrors the
                              // AddInvestmentModal Step 2 behavior.
                              const allFilled = next.every(r => r.committed_capital !== "" && Number(r.committed_capital.replace(/,/g, "")) > 0);
                              if (allFilled) {
                                const total = next.reduce((s, r) => s + Number(r.committed_capital.replace(/,/g, "")), 0);
                                for (let j = 0; j < next.length; j++) {
                                  const pct = Math.round((Number(next[j].committed_capital.replace(/,/g, "")) / total) * 10000) / 100;
                                  next[j] = { ...next[j], capital_pct: String(pct) };
                                }
                              }
                              setEditInternalInvestors(next);
                            }}
                            placeholder="Committed"
                          />
                        </div>
                        {editInternalInvestors.length > 1 && (
                          <button onClick={() => setEditInternalInvestors(editInternalInvestors.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 16 }}>&times;</button>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 12, color: "#9494a0" }}>Capital</span>
                          <input
                            type="number"
                            style={{ ...inputStyle, width: 70, textAlign: "right" }}
                            value={ei.capital_pct}
                            onChange={e => { const next = [...editInternalInvestors]; next[i] = { ...next[i], capital_pct: e.target.value }; setEditInternalInvestors(next); }}
                            placeholder="0"
                          />
                          <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 12, color: "#9494a0" }}>Profit</span>
                          <input
                            type="number"
                            style={{ ...inputStyle, width: 70, textAlign: "right" }}
                            value={ei.profit_pct}
                            onChange={e => { const next = [...editInternalInvestors]; next[i] = { ...next[i], profit_pct: e.target.value }; setEditInternalInvestors(next); }}
                            placeholder="0"
                          />
                          <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Running totals — updates live as the user types so they
                    can see the deal-wide commitment + capital % distribution
                    without doing the math themselves. */}
                {editInternalInvestors.length > 0 && (() => {
                  const totalCommitted = editInternalInvestors.reduce(
                    (s, ei) => s + (ei.committed_capital ? Number(ei.committed_capital.replace(/,/g, "")) || 0 : 0), 0
                  );
                  const totalCapPct = editInternalInvestors.reduce(
                    (s, ei) => s + (ei.capital_pct !== "" ? Number(ei.capital_pct) || 0 : 0), 0
                  );
                  const totalProfitPct = editInternalInvestors.reduce(
                    (s, ei) => s + (ei.profit_pct !== "" ? Number(ei.profit_pct) || 0 : 0), 0
                  );
                  const capPctOff = totalCapPct > 0 && Math.abs(totalCapPct - 100) > 0.02;
                  const profitPctOff = totalProfitPct > 0 && Math.abs(totalProfitPct - 100) > 0.02;
                  return (
                    <div style={{ marginTop: 6, padding: "8px 10px", background: "#fff", borderRadius: 8, border: "1px solid #e8e6df", display: "flex", gap: 16, alignItems: "center", fontSize: 12, color: "#1a1a1f" }}>
                      <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#9494a0" }}>Total</span>
                      <span>
                        <span style={{ color: "#9494a0" }}>Committed </span>
                        <strong>${totalCommitted.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong>
                      </span>
                      <span>
                        <span style={{ color: "#9494a0" }}>Capital </span>
                        <strong style={{ color: capPctOff ? "#c73e3e" : "#1a1a1f" }}>{totalCapPct.toFixed(2)}%</strong>
                      </span>
                      <span>
                        <span style={{ color: "#9494a0" }}>Profit </span>
                        <strong style={{ color: profitPctOff ? "#c73e3e" : "#1a1a1f" }}>{totalProfitPct.toFixed(2)}%</strong>
                      </span>
                      {(capPctOff || profitPctOff) && (
                        <span style={{ color: "#c73e3e", fontSize: 11 }}>Percentages should sum to 100%.</span>
                      )}
                    </div>
                  );
                })()}

                <button
                  onClick={() => setEditInternalInvestors([...editInternalInvestors, { id: null, entity_id: "", committed_capital: "", capital_pct: "", profit_pct: "" }])}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#3366a8", fontSize: 13, padding: 0, marginTop: 8 }}
                >+ Add Investor</button>
              </div>

              {/* External Co-Investors section */}
              <div style={{ paddingTop: 16, borderTop: "1px solid #e8e6df" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <h5 style={{ fontSize: 12, fontWeight: 600, margin: 0, color: "#1a1a1f", textTransform: "uppercase", letterSpacing: "0.06em" }}>Co-Investors (External)</h5>
                  <span style={{ fontSize: 11, color: "#9494a0" }}>Promoters, operators, lenders, and third parties in the deal for context</span>
                </div>

                {editCoInvestors.length === 0 && (
                  <div style={{ fontSize: 13, color: "#9494a0", padding: "8px 0" }}>No co-investors. Click below to add one.</div>
                )}

                {editCoInvestors.map((ci, i) => {
                const query = ci.name.toLowerCase();
                const isActive = activeCoIdx === i && query.length >= 2 && !ci.directory_entry_id;
                const suggestions = isActive ? directoryEntries.filter(d => d.name.toLowerCase().includes(query)).slice(0, 6) : [];
                const inputStyle = { width: "100%", padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #ddd9d0", background: "#fff" };
                return (
                  <div key={i} style={{ marginBottom: 10, background: "#fff", borderRadius: 8, padding: 10, border: "1px solid #e8e6df" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <div style={{ flex: 2, position: "relative" }}>
                        <input style={{ ...inputStyle, borderColor: ci.directory_entry_id ? "#2d8a4e" : "#ddd9d0" }}
                          value={ci.name}
                          onChange={e => { const next = [...editCoInvestors]; next[i] = { ...next[i], name: e.target.value, directory_entry_id: null }; setEditCoInvestors(next); setActiveCoIdx(i); }}
                          onFocus={() => setActiveCoIdx(i)}
                          onBlur={() => setTimeout(() => setActiveCoIdx(null), 150)}
                          placeholder="Search directory..." />
                        {ci.directory_entry_id && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#2d8a4e" }}>linked</span>}
                        {isActive && (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#fff", border: "1px solid #ddd9d0", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", maxHeight: 220, overflow: "auto" }}>
                            {suggestions.map(d => (
                              <button key={d.id} onMouseDown={e => { e.preventDefault(); const next = [...editCoInvestors]; next[i] = { ...next[i], name: d.name, directory_entry_id: d.id }; setEditCoInvestors(next); setActiveCoIdx(null); }}
                                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1f" }}
                                onMouseEnter={e => { e.currentTarget.style.background = "#f8f7f4"; }} onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                                {d.name}<span style={{ fontSize: 11, color: "#9494a0", marginLeft: 8 }}>{d.type}</span>
                              </button>
                            ))}
                            {ci.name.trim().length >= 2 && (
                              <button onMouseDown={async e => {
                                e.preventDefault();
                                const res = await fetch("/api/directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ci.name.trim(), type: "individual" }) });
                                if (res.ok) { const entry = await res.json(); const next = [...editCoInvestors]; next[i] = { ...next[i], name: entry.name, directory_entry_id: entry.id }; setEditCoInvestors(next); setDirectoryEntries(prev => [...prev, entry]); setActiveCoIdx(null); }
                              }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", borderTop: suggestions.length > 0 ? "1px solid #e8e6df" : "none", cursor: "pointer", fontSize: 13, color: "#2d5a3d", fontWeight: 500 }}
                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(45,90,61,0.04)"; }} onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                                + Create &quot;{ci.name.trim()}&quot; in directory
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <select style={{ ...inputStyle, width: 120, cursor: "pointer" }} value={ci.role} onChange={e => { const next = [...editCoInvestors]; next[i] = { ...next[i], role: e.target.value }; setEditCoInvestors(next); }}>
                        <option value="co_investor">Co-Investor</option>
                        <option value="promoter">Promoter</option>
                        <option value="operator">Operator</option>
                        <option value="lender">Lender</option>
                      </select>
                      <button onClick={() => setEditCoInvestors(editCoInvestors.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 16 }}>&times;</button>
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "#9494a0" }}>Capital</span>
                        <input type="number" style={{ ...inputStyle, width: 70, textAlign: "right" }} value={ci.capital_pct}
                          onChange={e => { const next = [...editCoInvestors]; next[i] = { ...next[i], capital_pct: e.target.value }; setEditCoInvestors(next); }} placeholder="0" />
                        <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "#9494a0" }}>Profit</span>
                        <input type="number" style={{ ...inputStyle, width: 70, textAlign: "right" }} value={ci.profit_pct}
                          onChange={e => { const next = [...editCoInvestors]; next[i] = { ...next[i], profit_pct: e.target.value }; setEditCoInvestors(next); }} placeholder="0" />
                        <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                      </div>
                      <input style={{ ...inputStyle, flex: 1 }} value={ci.notes} onChange={e => { const next = [...editCoInvestors]; next[i] = { ...next[i], notes: e.target.value }; setEditCoInvestors(next); }} placeholder="Notes (optional)" />
                    </div>
                  </div>
                );
              })}

              <button onClick={() => setEditCoInvestors([...editCoInvestors, { directory_entry_id: null, name: "", role: "co_investor", capital_pct: "", profit_pct: "", notes: "" }])}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#3366a8", fontSize: 13, padding: 0, marginTop: 4 }}>+ Add Co-Investor</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Internal Allocations — one section per investor that actually has
          something to allocate. Persons, joint_titles, and unpopulated LLCs
          have no entity_members rows, so there's nothing to split their
          share among. Hide the block in that case (unless legacy allocations
          already exist for the investor, in which case still show so users
          can see/edit them). */}
      {investors.map((inv) => {
        const allocs = allocsByInvestor[inv.id] || [];
        const members = membersByInvestor[inv.id] || [];
        const isEditing = editingInvestorId === inv.id;

        if (members.length === 0 && allocs.length === 0 && !isEditing) {
          return null;
        }

        if (isEditing) {
          return (
            <div key={inv.id} style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#1a1a1f" }}>
                  Allocations — {inv.entity_name || "Investor"}
                </h3>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" onClick={() => setEditingInvestorId(null)}>Cancel</Button>
                  <Button variant="primary" onClick={saveAllocations} disabled={Math.abs(totalPct - 100) > 0.02 && editAllocations.some(a => a.checked)}>Save</Button>
                </div>
              </div>

              <div style={{ background: "#f8f7f4", borderRadius: 10, padding: 16 }}>
                {editAllocations.filter(a => a.checked).length >= 2 && (
                  <div style={{ marginBottom: 12 }}>
                    <button onClick={() => {
                      const checked = editAllocations.filter(a => a.checked);
                      const count = checked.length;
                      const basePct = Math.floor(10000 / count) / 100;
                      const pctRemainder = Math.round((100 - basePct * count) * 100) / 100;
                      const totalCents = Math.round(totalContributed * 100);
                      const baseCents = Math.floor(totalCents / count);
                      const centsRemainder = totalCents - baseCents * count;
                      let idx = 0;
                      setEditAllocations(editAllocations.map(a => {
                        if (!a.checked) return a;
                        const isLast = idx === count - 1;
                        const pct = isLast ? basePct + pctRemainder : basePct;
                        const cents = isLast ? baseCents + centsRemainder : baseCents;
                        idx++;
                        return { ...a, allocation_pct: String(Math.round(pct * 100) / 100), committed_amount: totalContributed > 0 ? String(cents / 100) : "" };
                      }));
                    }} style={{ background: "none", border: "1px solid #ddd9d0", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12, color: "#3366a8", fontWeight: 500 }}>
                      Split Equally ({editAllocations.filter(a => a.checked).length} members)
                    </button>
                  </div>
                )}

                {editAllocations.map((alloc, i) => (
                  <div key={alloc.member_entity_id || alloc.member_directory_id || `alloc-${i}`} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
                    borderBottom: i < editAllocations.length - 1 ? "1px solid #e8e6df" : "none",
                  }}>
                    <input type="checkbox" checked={alloc.checked} onChange={e => {
                      const next = [...editAllocations]; next[i] = { ...next[i], checked: e.target.checked }; setEditAllocations(next);
                    }} />
                    <span style={{ flex: 1, fontSize: 13, color: "#1a1a1f", minWidth: 120 }}>{alloc.name}</span>
                    <input type="number" value={alloc.allocation_pct} onChange={e => {
                      const pct = e.target.value;
                      const next = [...editAllocations];
                      const update = { ...next[i], allocation_pct: pct };
                      if (totalContributed > 0 && pct !== "") update.committed_amount = String(Math.round((Number(pct) / 100) * totalContributed * 100) / 100);
                      next[i] = update; setEditAllocations(next);
                    }} placeholder="0" disabled={!alloc.checked} style={{ width: 70, padding: "4px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #ddd9d0", textAlign: "right", background: alloc.checked ? "#fff" : "#f0eee8" }} />
                    <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                    <span style={{ fontSize: 12, color: "#9494a0" }}>$</span>
                    <input type="number" value={alloc.committed_amount} onChange={e => {
                      const amt = e.target.value;
                      const next = [...editAllocations];
                      const update = { ...next[i], committed_amount: amt };
                      if (totalContributed > 0 && amt !== "") update.allocation_pct = String(Math.round((Number(amt) / totalContributed) * 100 * 100) / 100);
                      next[i] = update; setEditAllocations(next);
                    }} placeholder="0" disabled={!alloc.checked} style={{ width: 90, padding: "4px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #ddd9d0", textAlign: "right", background: alloc.checked ? "#fff" : "#f0eee8" }} />
                  </div>
                ))}

                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0 0", marginTop: 8, borderTop: "2px solid #ddd9d0" }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#1a1a1f", paddingLeft: 24 }}>Total</span>
                  <span style={{ width: 70, textAlign: "right", fontSize: 13, fontWeight: 600, color: Math.abs(totalPct - 100) > 0.02 ? "#c73e3e" : "#2d8a4e" }}>{totalPct.toFixed(2)}</span>
                  <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                  <span style={{ fontSize: 12, color: "#9494a0" }}>$</span>
                  <span style={{ width: 90, textAlign: "right", fontSize: 13, fontWeight: 600, color: "#1a1a1f" }}>{totalCommitted.toLocaleString()}</span>
                </div>
                {Math.abs(totalPct - 100) > 0.02 && editAllocations.some(a => a.checked) && (
                  <div style={{ fontSize: 12, color: "#c73e3e", marginTop: 8 }}>Allocations must sum to 100% (currently {totalPct.toFixed(2)}%)</div>
                )}
              </div>
            </div>
          );
        }

        // Read-only view
        return (
          <div key={inv.id} style={{ marginBottom: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#1a1a1f" }}>
                {investors.length > 1 ? `Allocations — ${inv.entity_name || "Investor"}` : "Internal Allocations"}
                {investors.length === 1 && inv.entity_name && <span style={{ fontWeight: 400, color: "#9494a0" }}> — {inv.entity_name}</span>}
              </h3>
              <Button variant="secondary" onClick={() => startEditing(inv.id)}>Edit</Button>
            </div>

            {allocs.length === 0 ? (
              <div style={{ textAlign: "center", padding: "30px 0" }}>
                <div style={{ fontSize: 14, color: "#9494a0", marginBottom: 12 }}>No allocations set for {inv.entity_name || "this investor"}.</div>
                <Button variant="primary" onClick={() => startEditing(inv.id)}><PlusIcon size={14} /> Set Allocations</Button>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Member", "Allocation", "Committed"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: h === "Member" ? "left" : "right", fontSize: 11, fontWeight: 600, color: "#9494a0", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #e8e6df" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allocs.map(alloc => (
                    <tr key={alloc.id}>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", borderBottom: "1px solid #f0eee8" }}>{alloc.member_name || "Unknown"}</td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>{Number(alloc.allocation_pct).toFixed(2)}%</td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "#1a1a1f", textAlign: "right", borderBottom: "1px solid #f0eee8" }}>
                        {inv.committed_capital != null
                          ? fmtDollars(Math.round(Number(alloc.allocation_pct) / 100 * Number(inv.committed_capital) * 100) / 100)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, borderTop: "2px solid #ddd9d0" }}>Total</td>
                    <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, textAlign: "right", borderTop: "2px solid #ddd9d0" }}>{allocs.reduce((s, a) => s + Number(a.allocation_pct), 0).toFixed(2)}%</td>
                    <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, textAlign: "right", borderTop: "2px solid #ddd9d0" }}>
                      {inv.committed_capital != null ? fmtDollars(Number(inv.committed_capital)) : "$0"}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
