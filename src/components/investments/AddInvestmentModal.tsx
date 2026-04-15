"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/ui/icons";
import type { InvestmentType } from "@/lib/types/investments";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

interface EntityOption {
  id: string;
  name: string;
  short_name: string | null;
  members: { id: string; name: string; directory_entry_id: string | null; ref_entity_id: string | null }[];
}

interface DirectoryEntry {
  id: string;
  name: string;
  type: string;
}

interface InvestorRow {
  entity_id: string;
  entity_name: string;
  capital_pct: string;
  profit_pct: string;
  committed_capital: string;
}

interface CoInvestorRow {
  name: string;
  directory_entry_id: string | null;
  role: string;
  capital_pct: string;
  profit_pct: string;
}

const INVESTMENT_TYPES: { value: InvestmentType; label: string }[] = [
  { value: "real_estate", label: "Real Estate" },
  { value: "startup", label: "Startup" },
  { value: "fund", label: "Fund" },
  { value: "private_equity", label: "Private Equity" },
  { value: "debt", label: "Debt" },
  { value: "other", label: "Other" },
];

const STEPS = ["Basics", "Ownership", "Contribution", "Allocations"];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8,
  border: "1px solid #ddd9d0", background: "#fff",
};
const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: "#6b6b76", display: "block", marginBottom: 4,
};

export function AddInvestmentModal({ onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1: Basics
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [investmentType, setInvestmentType] = useState<InvestmentType>("real_estate");
  const [formationState, setFormationState] = useState("");
  const [dateInvested, setDateInvested] = useState("");
  const [description, setDescription] = useState("");
  const [preferredReturnPct, setPreferredReturnPct] = useState("");
  const [preferredReturnBasis, setPreferredReturnBasis] = useState("");

  // Step 2: Investors + Co-Investors
  const [investorRows, setInvestorRows] = useState<InvestorRow[]>([]);
  const [coInvestors, setCoInvestors] = useState<CoInvestorRow[]>([]);
  const [activeCoIdx, setActiveCoIdx] = useState<number | null>(null);

  // Step 3: Contribution
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionDate, setContributionDate] = useState(new Date().toISOString().slice(0, 10));
  const [contributionDescription, setContributionDescription] = useState("");

  // Step 4: Allocations (per investor — simplified for single investor in v1)
  const [skipAllocations, setSkipAllocations] = useState(false);
  const [memberAllocations, setMemberAllocations] = useState<
    Array<{ directory_entry_id: string | null; ref_entity_id: string | null; name: string; checked: boolean; allocation_pct: string; committed_amount: string }>
  >([]);

  // Data
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([]);

  useEffect(() => {
    async function load() {
      const [entRes, dirRes] = await Promise.all([fetch("/api/entities"), fetch("/api/directory")]);
      if (entRes.ok) {
        const data = await entRes.json();
        // Investing entities can be any type that holds an interest in the
        // deal: LLCs, trusts, persons, joint_title entities. The old filter
        // gated on `members.length > 0` (which assumed an LLC with cap-table
        // members), excluding persons (no members), joint_title entities
        // (members live in joint_title_members), and unpopulated LLCs.
        setEntities(data);
      }
      if (dirRes.ok) setDirectoryEntries(await dirRes.json());
    }
    load();
  }, []);

  // When investor selection changes, populate member allocations from first
  // investor's members. Person and joint_title entities have no members in
  // entity_members, so the allocation step will collapse to the "skip"
  // case — the person/joint_title holds 100% of its share directly.
  useEffect(() => {
    if (investorRows.length === 0) { setMemberAllocations([]); return; }
    const firstInvestor = investorRows[0];
    const entity = entities.find(e => e.id === firstInvestor.entity_id);
    if (entity?.members && entity.members.length > 0) {
      setMemberAllocations(entity.members.map(m => ({
        directory_entry_id: m.directory_entry_id || null,
        ref_entity_id: m.ref_entity_id || null,
        name: m.name, checked: true, allocation_pct: "", committed_amount: "",
      })));
    } else {
      setMemberAllocations([]);
    }
  }, [investorRows, entities]);

  const addInvestor = (entityId: string) => {
    const entity = entities.find(e => e.id === entityId);
    if (!entity || investorRows.some(r => r.entity_id === entityId)) return;
    setInvestorRows([...investorRows, { entity_id: entityId, entity_name: entity.name, capital_pct: "", profit_pct: "", committed_capital: "" }]);
  };

  const canNext = () => {
    if (step === 0) return name.trim() && investorRows.length > 0;
    return true;
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/investments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, short_name: shortName || undefined,
          investment_type: investmentType,
          formation_state: formationState || undefined,
          date_invested: dateInvested || undefined,
          description: description || undefined,
          preferred_return_pct: preferredReturnPct ? Number(preferredReturnPct) : undefined,
          preferred_return_basis: preferredReturnBasis || undefined,
          investors: investorRows.map(r => ({
            entity_id: r.entity_id,
            capital_pct: r.capital_pct !== "" ? Number(r.capital_pct) : null,
            profit_pct: r.profit_pct !== "" ? Number(r.profit_pct) : null,
            committed_capital: r.committed_capital !== "" ? Number(r.committed_capital) : null,
          })),
          co_investors: coInvestors.filter(c => c.directory_entry_id).map(c => ({
            directory_entry_id: c.directory_entry_id,
            role: c.role || "co_investor",
            capital_pct: c.capital_pct !== "" ? Number(c.capital_pct) : null,
            profit_pct: c.profit_pct !== "" ? Number(c.profit_pct) : null,
          })),
        }),
      });
      if (!res.ok) { const err = await res.json(); alert(err.error || "Failed to create"); setSaving(false); return; }

      const investment = await res.json();
      const investmentId = investment.id;

      // Get investor IDs from created investment
      const detailRes = await fetch(`/api/investments/${investmentId}`);
      const detail = detailRes.ok ? await detailRes.json() : null;
      const createdInvestors = detail?.investors || [];

      // Save allocations for first investor (if not skipped)
      if (!skipAllocations && createdInvestors.length > 0) {
        const firstInvestorId = createdInvestors[0].id;
        const activeAllocs = memberAllocations.filter(a => a.checked && Number(a.allocation_pct) > 0);
        if (activeAllocs.length > 0) {
          await fetch(`/api/investments/${investmentId}/allocations`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              investor_id: firstInvestorId,
              allocations: activeAllocs.map(a => ({
                ...(a.ref_entity_id ? { member_entity_id: a.ref_entity_id } : {}),
                ...(a.directory_entry_id ? { member_directory_id: a.directory_entry_id } : {}),
                allocation_pct: Number(a.allocation_pct),
                committed_amount: a.committed_amount ? Number(a.committed_amount) : null,
              })),
            }),
          });
        }
      }

      // Record contribution for first investor
      if (contributionAmount && Number(contributionAmount) > 0 && createdInvestors.length > 0) {
        await fetch(`/api/investments/${investmentId}/transactions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            investment_investor_id: createdInvestors[0].id,
            transaction_type: "contribution",
            amount: Number(contributionAmount),
            transaction_date: contributionDate,
            description: contributionDescription || "Initial contribution",
            split_by_allocation: true,
          }),
        });
      }

      onCreated();
    } catch (err) { console.error(err); alert("Failed to create"); }
    finally { setSaving(false); }
  };

  const allocTotalPct = memberAllocations.filter(a => a.checked).reduce((s, a) => s + (Number(a.allocation_pct) || 0), 0);

  // Available entities for investor selection (exclude already selected)
  const availableEntities = entities.filter(e => !investorRows.some(r => r.entity_id === e.id));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#ffffff", borderRadius: 14, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 0" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a1f" }}>Add Investment</div>
            <div style={{ fontSize: 12, color: "#9494a0", marginTop: 2 }}>Step {step + 1} of {STEPS.length} — {STEPS[step]}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><XIcon size={18} /></button>
        </div>

        <div style={{ display: "flex", gap: 4, padding: "12px 24px" }}>
          {STEPS.map((_, i) => (<div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? "#2d5a3d" : "#e8e6df" }} />))}
        </div>

        <div style={{ padding: "8px 24px 24px" }}>

          {/* Step 1: Basics + Investor Selection */}
          {step === 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Investment Name *</label>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g., 3680 Colonial LLC" />
              </div>
              <div>
                <label style={labelStyle}>Type *</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {INVESTMENT_TYPES.map(t => (
                    <button key={t.value} onClick={() => setInvestmentType(t.value)} style={{
                      padding: "6px 14px", borderRadius: 6,
                      border: `1px solid ${investmentType === t.value ? "#2d5a3d" : "#ddd9d0"}`,
                      background: investmentType === t.value ? "rgba(45,90,61,0.08)" : "#fff",
                      color: investmentType === t.value ? "#2d5a3d" : "#6b6b76", fontSize: 13, fontWeight: 500, cursor: "pointer",
                    }}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={labelStyle}>Investing Entities *</label>
                {investorRows.map((inv, i) => (
                  <div key={inv.entity_id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ flex: 1, fontSize: 14, color: "#1a1a1f" }}>{inv.entity_name}</span>
                    <button onClick={() => setInvestorRows(investorRows.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 16 }}>&times;</button>
                  </div>
                ))}
                {availableEntities.length > 0 && (
                  <select style={{ ...inputStyle, cursor: "pointer" }} value="" onChange={e => { if (e.target.value) addInvestor(e.target.value); }}>
                    <option value="">Add entity...</option>
                    {availableEntities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Formation State</label>
                  <input style={inputStyle} value={formationState} onChange={e => setFormationState(e.target.value)} placeholder="e.g., Delaware" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Date Invested</label>
                  <input type="date" style={inputStyle} value={dateInvested} onChange={e => setDateInvested(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={description} onChange={e => setDescription(e.target.value)} placeholder="Notes about the deal..." />
              </div>
            </div>
          )}

          {/* Step 2: Ownership */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Investor Positions</label>
                {investorRows.map((inv, i) => (
                  <div key={inv.entity_id} style={{ marginBottom: 10, background: "#f8f7f4", borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1f", marginBottom: 6 }}>{inv.entity_name}</div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "#9494a0" }}>Committed</span>
                        <span style={{ fontSize: 12, color: "#9494a0" }}>$</span>
                        <input type="number" style={{ ...inputStyle, width: 110, textAlign: "right" }} value={inv.committed_capital}
                          onChange={e => {
                            const next = [...investorRows];
                            next[i] = { ...next[i], committed_capital: e.target.value };
                            // If every row has a dollar amount, auto-derive
                            // capital_pct from each row's $ / total $.
                            const allFilled = next.every(r => r.committed_capital !== "" && Number(r.committed_capital) > 0);
                            if (allFilled) {
                              const total = next.reduce((s, r) => s + Number(r.committed_capital), 0);
                              for (let j = 0; j < next.length; j++) {
                                const pct = Math.round((Number(next[j].committed_capital) / total) * 10000) / 100;
                                next[j] = { ...next[j], capital_pct: String(pct) };
                              }
                            }
                            setInvestorRows(next);
                          }} placeholder="0" />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "#9494a0" }}>Capital</span>
                        <input type="number" style={{ ...inputStyle, width: 70, textAlign: "right" }} value={inv.capital_pct}
                          onChange={e => { const next = [...investorRows]; next[i] = { ...next[i], capital_pct: e.target.value }; setInvestorRows(next); }} placeholder="0" />
                        <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "#9494a0" }}>Profit</span>
                        <input type="number" style={{ ...inputStyle, width: 70, textAlign: "right" }} value={inv.profit_pct}
                          onChange={e => { const next = [...investorRows]; next[i] = { ...next[i], profit_pct: e.target.value }; setInvestorRows(next); }} placeholder="0" />
                        <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "#9494a0", marginTop: 6 }}>
                      Enter dollars, percentages, or both. If every investor has a dollar amount, Capital % auto-fills from the totals.
                    </div>
                  </div>
                ))}
              </div>

              {/* Preferred return */}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Preferred Return %</label>
                  <input type="number" style={{ ...inputStyle, width: 90 }} value={preferredReturnPct} onChange={e => setPreferredReturnPct(e.target.value)} placeholder="0" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Basis</label>
                  <select style={{ ...inputStyle, cursor: "pointer" }} value={preferredReturnBasis} onChange={e => setPreferredReturnBasis(e.target.value)}>
                    <option value="">None</option>
                    <option value="capital_contributed">Capital Contributed</option>
                    <option value="capital_committed">Capital Committed</option>
                  </select>
                </div>
              </div>

              {/* Co-investors */}
              <div>
                <label style={labelStyle}>Co-Investors (optional)</label>
                {coInvestors.map((ci, i) => {
                  const query = ci.name.toLowerCase();
                  const isActive = activeCoIdx === i && query.length >= 2 && !ci.directory_entry_id;
                  const suggestions = isActive ? directoryEntries.filter(d => d.name.toLowerCase().includes(query)).slice(0, 6) : [];
                  return (
                    <div key={i} style={{ marginBottom: 10, background: "#f8f7f4", borderRadius: 8, padding: 10 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                        <div style={{ flex: 2, position: "relative" }}>
                          <input style={{ ...inputStyle, borderColor: ci.directory_entry_id ? "#2d8a4e" : "#ddd9d0" }}
                            value={ci.name} onChange={e => { const next = [...coInvestors]; next[i] = { ...next[i], name: e.target.value, directory_entry_id: null }; setCoInvestors(next); setActiveCoIdx(i); }}
                            onFocus={() => setActiveCoIdx(i)} onBlur={() => setTimeout(() => setActiveCoIdx(null), 150)} placeholder="Search directory..." />
                          {ci.directory_entry_id && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "#2d8a4e" }}>linked</span>}
                          {isActive && (
                            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#fff", border: "1px solid #ddd9d0", borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.08)", maxHeight: 220, overflow: "auto" }}>
                              {suggestions.map(d => (
                                <button key={d.id} onMouseDown={e => { e.preventDefault(); const next = [...coInvestors]; next[i] = { ...next[i], name: d.name, directory_entry_id: d.id }; setCoInvestors(next); setActiveCoIdx(null); }}
                                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1f" }}
                                  onMouseEnter={e => { e.currentTarget.style.background = "#f8f7f4"; }} onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                                  {d.name}<span style={{ fontSize: 11, color: "#9494a0", marginLeft: 8 }}>{d.type}</span>
                                </button>
                              ))}
                              <button onMouseDown={async e => {
                                e.preventDefault();
                                const res = await fetch("/api/directory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: ci.name.trim(), type: "individual" }) });
                                if (res.ok) { const entry = await res.json(); const next = [...coInvestors]; next[i] = { ...next[i], name: entry.name, directory_entry_id: entry.id }; setCoInvestors(next); setDirectoryEntries(prev => [...prev, entry]); setActiveCoIdx(null); }
                              }} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", borderTop: suggestions.length > 0 ? "1px solid #e8e6df" : "none", cursor: "pointer", fontSize: 13, color: "#2d5a3d", fontWeight: 500 }}
                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(45,90,61,0.04)"; }} onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
                                + Create &quot;{ci.name.trim()}&quot; in directory
                              </button>
                            </div>
                          )}
                        </div>
                        <select style={{ ...inputStyle, width: 110, cursor: "pointer" }} value={ci.role} onChange={e => { const next = [...coInvestors]; next[i] = { ...next[i], role: e.target.value }; setCoInvestors(next); }}>
                          <option value="co_investor">Co-Investor</option><option value="promoter">Promoter</option><option value="operator">Operator</option><option value="lender">Lender</option>
                        </select>
                        <button onClick={() => setCoInvestors(coInvestors.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", fontSize: 16 }}>&times;</button>
                      </div>
                      <div style={{ display: "flex", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 12, color: "#9494a0" }}>Capital</span>
                          <input type="number" style={{ ...inputStyle, width: 65, textAlign: "right" }} value={ci.capital_pct}
                            onChange={e => { const next = [...coInvestors]; next[i] = { ...next[i], capital_pct: e.target.value }; setCoInvestors(next); }} placeholder="0" />
                          <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 12, color: "#9494a0" }}>Profit</span>
                          <input type="number" style={{ ...inputStyle, width: 65, textAlign: "right" }} value={ci.profit_pct}
                            onChange={e => { const next = [...coInvestors]; next[i] = { ...next[i], profit_pct: e.target.value }; setCoInvestors(next); }} placeholder="0" />
                          <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <button onClick={() => setCoInvestors([...coInvestors, { name: "", directory_entry_id: null, role: "co_investor", capital_pct: "", profit_pct: "" }])}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#3366a8", fontSize: 13, padding: 0 }}>+ Add Co-Investor</button>
              </div>
            </div>
          )}

          {/* Step 3: Contribution */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 14, color: "#6b6b76", lineHeight: 1.5 }}>
                How much was contributed{investorRows.length === 1 ? ` by ${investorRows[0].entity_name}` : ""}? Optional.
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Amount</label>
                  <input type="number" style={inputStyle} value={contributionAmount} onChange={e => setContributionAmount(e.target.value)} placeholder="0" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Date</label>
                  <input type="date" style={inputStyle} value={contributionDate} onChange={e => setContributionDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <input style={inputStyle} value={contributionDescription} onChange={e => setContributionDescription(e.target.value)} placeholder="Initial capital contribution" />
              </div>
            </div>
          )}

          {/* Step 4: Allocations */}
          {step === 3 && (
            <div>
              <div style={{ fontSize: 14, color: "#1a1a1f", marginBottom: 12, lineHeight: 1.5 }}>
                {investorRows.length === 1 && memberAllocations.length === 0
                  ? `${investorRows[0].entity_name} holds this interest directly — no internal allocation needed.`
                  : investorRows.length === 1
                  ? `How is ${investorRows[0].entity_name}'s share split among its members?`
                  : "Set member allocations for each investor on the investment detail page after creation."}
              </div>

              {investorRows.length === 1 && memberAllocations.length > 0 && (
                <div style={{ background: "#f8f7f4", borderRadius: 10, padding: 12 }}>
                  {memberAllocations.map((alloc, i) => (
                    <div key={alloc.ref_entity_id || alloc.directory_entry_id || `m-${i}`} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                      borderBottom: i < memberAllocations.length - 1 ? "1px solid #e8e6df" : "none",
                    }}>
                      <input type="checkbox" checked={alloc.checked} onChange={e => {
                        const next = [...memberAllocations]; next[i] = { ...next[i], checked: e.target.checked }; setMemberAllocations(next);
                      }} />
                      <span style={{ flex: 1, fontSize: 13, color: "#1a1a1f", minWidth: 100 }}>{alloc.name}</span>
                      <input type="number" value={alloc.allocation_pct} onChange={e => {
                        const next = [...memberAllocations]; next[i] = { ...next[i], allocation_pct: e.target.value }; setMemberAllocations(next);
                      }} placeholder="0" disabled={!alloc.checked} style={{ width: 65, padding: "4px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #ddd9d0", textAlign: "right", background: alloc.checked ? "#fff" : "#f0eee8" }} />
                      <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                      <span style={{ fontSize: 12, color: "#9494a0" }}>$</span>
                      <input type="number" value={alloc.committed_amount} onChange={e => {
                        const next = [...memberAllocations]; next[i] = { ...next[i], committed_amount: e.target.value }; setMemberAllocations(next);
                      }} placeholder="0" disabled={!alloc.checked} style={{ width: 80, padding: "4px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #ddd9d0", textAlign: "right", background: alloc.checked ? "#fff" : "#f0eee8" }} />
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0 0", marginTop: 6, borderTop: "2px solid #ddd9d0" }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, paddingLeft: 22 }}>Total</span>
                    <span style={{ width: 65, textAlign: "right", fontSize: 13, fontWeight: 600, color: Math.abs(allocTotalPct - 100) > 0.02 ? "#c73e3e" : "#2d8a4e" }}>{allocTotalPct.toFixed(2)}</span>
                    <span style={{ fontSize: 12, color: "#9494a0" }}>%</span>
                  </div>
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#6b6b76", marginTop: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={skipAllocations} onChange={e => setSkipAllocations(e.target.checked)} />
                Skip — I&apos;ll set allocations later
              </label>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", padding: "16px 24px", borderTop: "1px solid #e8e6df" }}>
          <div>{step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>&larr; Back</Button>}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            {step < STEPS.length - 1
              ? <Button variant="primary" onClick={() => setStep(step + 1)} disabled={!canNext()}>Next &rarr;</Button>
              : <Button variant="primary" onClick={handleCreate} disabled={saving}>{saving ? "Creating..." : "Create"}</Button>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
