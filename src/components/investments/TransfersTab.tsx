"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { InvestmentInvestor } from "@/lib/types/investments";

interface Transfer {
  id: string;
  from_entity_id: string | null;
  to_entity_id: string | null;
  from_entity_name: string;
  to_entity_name: string;
  transfer_type: "gift" | "sale" | "other";
  transferred_pct: number;
  fair_market_value: number | null;
  cost_basis: number | null;
  transfer_date: string;
  notes: string | null;
  created_at: string;
}

interface Props {
  investmentId: string;
  investors: InvestmentInvestor[];
  isMobile?: boolean;
  onTransferRecorded?: () => void;
}

function fmtDollars(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const TYPE_LABELS: Record<Transfer["transfer_type"], string> = {
  gift: "Gift",
  sale: "Sale",
  other: "Other",
};

const th: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--faint)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  borderBottom: "1px solid var(--line)",
};
const td: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--ink)",
  borderBottom: "1px solid var(--hover)",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  border: "1px solid var(--line)",
  borderRadius: 6,
  background: "var(--card)",
  color: "var(--ink)",
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--muted)",
  marginBottom: 4,
  display: "block",
};

export function TransfersTab({ investmentId, investors, onTransferRecorded }: Props) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [allEntities, setAllEntities] = useState<Array<{ id: string; name: string }>>([]);

  // Form fields.
  const [fromEntityId, setFromEntityId] = useState("");
  const [toEntityId, setToEntityId] = useState("");
  const [transferType, setTransferType] = useState<Transfer["transfer_type"]>("gift");
  const [transferredPct, setTransferredPct] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [fairMarketValue, setFairMarketValue] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/investments/${investmentId}/transfers`);
      setTransfers(res.ok ? await res.json() : []);
    } catch {
      setTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [investmentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAllEntities((data || []).map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }))))
      .catch(() => {});
  }, []);

  const resetForm = () => {
    setFromEntityId("");
    setToEntityId("");
    setTransferType("gift");
    setTransferredPct("");
    setTransferDate("");
    setFairMarketValue("");
    setCostBasis("");
    setNotes("");
    setError(null);
  };

  // Live preview of the resulting cap-table change.
  const fromInvestor = investors.find((i) => i.entity_id === fromEntityId);
  const fromCapBefore = fromInvestor?.capital_pct != null ? Number(fromInvestor.capital_pct) : null;
  const pctNum = Number(transferredPct);
  const validPct = Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 100;
  const stakeFraction =
    fromCapBefore != null && fromCapBefore > 0 && validPct
      ? Math.round((pctNum / fromCapBefore) * 1000) / 10
      : null;
  const toInvestor = investors.find((i) => i.entity_id === toEntityId);
  const toCapBefore = toInvestor?.capital_pct != null ? Number(toInvestor.capital_pct) : 0;

  const canSubmit =
    fromEntityId &&
    toEntityId &&
    fromEntityId !== toEntityId &&
    validPct &&
    (fromCapBefore == null || fromCapBefore + 0.0001 >= pctNum);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/investments/${investmentId}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_entity_id: fromEntityId,
          to_entity_id: toEntityId,
          transfer_type: transferType,
          transferred_pct: pctNum,
          fair_market_value: fairMarketValue.trim() ? Number(fairMarketValue) : null,
          cost_basis: costBasis.trim() ? Number(costBasis) : null,
          transfer_date: transferDate || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to record transfer");
        return;
      }
      resetForm();
      setShowForm(false);
      await load();
      onTransferRecorded?.();
    } catch {
      setError("Failed to record transfer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "0 0 16px" }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "var(--ink)" }}>Ownership Transfers</h3>
        {!showForm && (
          <Button
            variant="secondary"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            Record transfer
          </Button>
        )}
      </div>

      {showForm && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16, marginBottom: 24, background: "var(--card)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>From (giving entity)</label>
              <select style={inputStyle} value={fromEntityId} onChange={(e) => setFromEntityId(e.target.value)}>
                <option value="">Select an investor…</option>
                {investors.map((inv) => (
                  <option key={inv.entity_id} value={inv.entity_id}>
                    {inv.entity_name || "Unknown"}
                    {inv.capital_pct != null ? ` — owns ${Number(inv.capital_pct)}%` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>To (receiving entity)</label>
              <select style={inputStyle} value={toEntityId} onChange={(e) => setToEntityId(e.target.value)}>
                <option value="">Select an entity…</option>
                {allEntities
                  .filter((e) => e.id !== fromEntityId)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Transfer type</label>
              <select style={inputStyle} value={transferType} onChange={(e) => setTransferType(e.target.value as Transfer["transfer_type"])}>
                <option value="gift">Gift</option>
                <option value="sale">Sale</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership transferred (% of investment)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                max="100"
                step="0.0001"
                value={transferredPct}
                onChange={(e) => setTransferredPct(e.target.value)}
                placeholder="e.g. 25"
              />
            </div>
            <div>
              <label style={labelStyle}>Transfer date</label>
              <input style={inputStyle} type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Fair market value ($)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={fairMarketValue}
                onChange={(e) => setFairMarketValue(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div>
              <label style={labelStyle}>Cost basis ($)</label>
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                value={costBasis}
                onChange={(e) => setCostBasis(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Notes</label>
              <textarea
                style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional context on the transfer"
              />
            </div>
          </div>

          {/* Live preview of the resulting cap-table change. */}
          {fromEntityId && toEntityId && validPct && (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--hover)", borderRadius: 6, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
              {fromCapBefore != null ? (
                <div>
                  <strong style={{ color: "var(--ink)" }}>{fromInvestor?.entity_name}</strong>: {fromCapBefore}% → {Math.round((fromCapBefore - pctNum) * 10000) / 10000}%
                  {stakeFraction != null ? ` (${stakeFraction}% of their stake)` : ""}
                </div>
              ) : (
                <div>{fromInvestor?.entity_name} has no recorded capital %; enter one on the Allocations tab first for an accurate preview.</div>
              )}
              <div>
                <strong style={{ color: "var(--ink)" }}>{allEntities.find((e) => e.id === toEntityId)?.name}</strong>: {toCapBefore}% → {Math.round((toCapBefore + pctNum) * 10000) / 10000}%
                {!toInvestor ? " (added as a new investor)" : ""}
              </div>
            </div>
          )}

          {error && <div style={{ marginTop: 12, fontSize: 13, color: "var(--red)" }}>{error}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button variant="primary" onClick={submit} disabled={!canSubmit || saving}>
              {saving ? "Recording…" : "Record transfer"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--faint)", fontSize: 13 }}>Loading transfers…</div>
      ) : transfers.length === 0 ? (
        <div style={{ color: "var(--faint)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
          No ownership transfers recorded yet.
        </div>
      ) : (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>From → To</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: "right" }}>Transferred</th>
                <th style={{ ...th, textAlign: "right" }}>FMV</th>
                <th style={{ ...th, textAlign: "right" }}>Cost basis</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td style={td}>{new Date(t.transfer_date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</td>
                  <td style={td}>
                    <span style={{ color: "var(--ink)" }}>{t.from_entity_name}</span>
                    <span style={{ color: "var(--faint)", margin: "0 6px" }}>→</span>
                    <span style={{ color: "var(--ink)" }}>{t.to_entity_name}</span>
                    {t.notes ? <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2 }}>{t.notes}</div> : null}
                  </td>
                  <td style={td}>{TYPE_LABELS[t.transfer_type]}</td>
                  <td style={{ ...td, textAlign: "right" }}>{Number(t.transferred_pct)}%</td>
                  <td style={{ ...td, textAlign: "right" }}>{t.fair_market_value != null ? fmtDollars(Number(t.fair_market_value)) : "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>{t.cost_basis != null ? fmtDollars(Number(t.cost_basis)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
