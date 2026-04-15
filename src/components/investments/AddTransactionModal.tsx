"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/ui/icons";
import type {
  InvestmentInvestor,
  TransactionLineItem,
  TransactionLineItemCategory,
} from "@/lib/types/investments";

/**
 * Modal for transaction CRUD on an investment.
 *
 * Three modes:
 *   1. create — new transaction (capital call, distribution, RoC). POSTs.
 *   2. edit   — fix typos on an existing row (wrong date, amount, line items).
 *               PATCHes. The original row is mutated in place. Most common
 *               operation, surfaced as the "Edit" button on each row.
 *   3. adjust — record an after-the-fact financial amendment to a previously
 *               correct row (e.g., sponsor recall). POSTs a new row whose
 *               adjusts_transaction_id points at the original. Buried as a
 *               secondary action inside the expanded line-items panel because
 *               it's rare and easy to misuse.
 *
 * Spec 036: line items live in JSONB on the parent row. The modal builds
 * the line_items array client-side with inline sum validation.
 */

interface ExistingTransaction {
  id: string;
  investment_investor_id: string;
  transaction_type: string;
  amount: number;
  transaction_date: string;
  description: string | null;
  line_items?: TransactionLineItem[] | null;
}

interface Props {
  investmentId: string;
  investors: InvestmentInvestor[];
  /** When set, opens in EDIT mode — pre-fills all fields, PATCHes the
   *  original row on save. Used for fixing typos. */
  editOriginal?: ExistingTransaction | null;
  /** When set, opens in ADJUST mode — pre-fills investor + type, creates a
   *  new amendment row referencing the original. Used for after-the-fact
   *  financial changes (recalls, corrections that need a ledger entry). */
  adjustsOriginal: ExistingTransaction | null;
  onClose: () => void;
  onSaved: () => void;
}

type TxnType = "contribution" | "distribution" | "return_of_capital";

interface DraftLineItem {
  category: TransactionLineItemCategory;
  amount: string; // string while editing, parsed on submit
  description: string;
}

const CONTRIBUTION_CATEGORIES: Array<{ value: TransactionLineItemCategory; label: string }> = [
  { value: "subscription", label: "Subscription (counts against committed)" },
  { value: "monitoring_fee", label: "Monitoring Fee" },
  { value: "management_fee", label: "Management Fee" },
  { value: "audit_tax_expense", label: "Audit & Tax Expense" },
  { value: "organizational_expense", label: "Organizational Expense" },
  { value: "legal_expense", label: "Legal Expense" },
  { value: "late_fee", label: "Late Fee" },
  { value: "other_contribution_expense", label: "Other Expense" },
];

const DISTRIBUTION_CATEGORIES: Array<{ value: TransactionLineItemCategory; label: string }> = [
  { value: "gross_distribution", label: "Gross Distribution (headline)" },
  { value: "carried_interest", label: "Carried Interest (reduction)" },
  { value: "tax_withholding", label: "Tax Withholding (reduction)" },
  { value: "compliance_holdback", label: "Compliance Holdback (reduction)" },
  { value: "operating_cashflows", label: "Operating Cashflows" },
  { value: "return_of_capital", label: "Return of Capital portion" },
  { value: "other_distribution_adjustment", label: "Other Adjustment" },
];

function categoriesFor(t: TxnType) {
  if (t === "contribution") return CONTRIBUTION_CATEGORIES;
  if (t === "distribution") return DISTRIBUTION_CATEGORIES;
  return []; // return_of_capital is all-or-nothing — no line items
}

function defaultCategoryFor(t: TxnType): TransactionLineItemCategory {
  return t === "distribution" ? "gross_distribution" : "subscription";
}

export function AddTransactionModal({
  investmentId,
  investors,
  editOriginal,
  adjustsOriginal,
  onClose,
  onSaved,
}: Props) {
  const isEdit = !!editOriginal;
  const isAdjust = !!adjustsOriginal;
  // The "source row" the form is operating on, used for pre-filling.
  // For create mode, sourceRow is null.
  const sourceRow = editOriginal || adjustsOriginal || null;

  const [investorId, setInvestorId] = useState<string>(
    sourceRow?.investment_investor_id ||
      (investors.length === 1 ? investors[0].id : "")
  );
  const [txnType, setTxnType] = useState<TxnType>(
    (sourceRow?.transaction_type as TxnType) || "contribution"
  );
  // Edit mode: pre-fill with original amount.
  // Adjust mode: pre-fill with the original amount too — the user edits the
  //   absolute value they WANT it to be, the modal computes the delta on save.
  // Create mode: empty.
  const [amount, setAmount] = useState<string>(
    sourceRow ? String(sourceRow.amount) : ""
  );
  const [date, setDate] = useState<string>(
    sourceRow?.transaction_date || new Date().toISOString().slice(0, 10)
  );
  const [description, setDescription] = useState<string>(sourceRow?.description || "");
  const [adjustmentReason, setAdjustmentReason] = useState<string>("");
  const [lineItems, setLineItems] = useState<DraftLineItem[]>(() => {
    const original = sourceRow?.line_items;
    if (!Array.isArray(original) || original.length === 0) return [];
    return original.map((li) => ({
      category: li.category,
      amount: String(li.amount),
      description: li.description || "",
    }));
  });
  const [showLineItems, setShowLineItems] = useState<boolean>(() => {
    return Array.isArray(sourceRow?.line_items) && (sourceRow?.line_items?.length || 0) > 0;
  });
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // When transaction_type changes (CREATE mode only — type is locked in
  // edit/adjust modes), reset line items so we don't carry illegal categories
  // across. Skip on initial mount via the ref guard so pre-filled line items
  // in edit/adjust mode survive.
  const firstMount = useRef(true);
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    if (isEdit || isAdjust) return;
    setLineItems([]);
    setShowLineItems(false);
  }, [txnType, isEdit, isAdjust]);

  const addLineItem = () => {
    setShowLineItems(true);
    setLineItems((prev) => [
      ...prev,
      { category: defaultCategoryFor(txnType), amount: "", description: "" },
    ]);
  };

  const removeLineItem = (i: number) => {
    setLineItems((prev) => prev.filter((_, idx) => idx !== i));
  };

  const updateLineItem = (i: number, patch: Partial<DraftLineItem>) => {
    setLineItems((prev) => prev.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));
  };

  // Live validation summary for the user. The user always edits ABSOLUTE
  // values (the new state of the row) regardless of mode — adjust mode
  // converts to deltas at save time. So the same positive-amount rule applies
  // in every mode.
  const validation = useMemo(() => {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount)) return { ok: false, message: "Amount is required" };
    if (parsedAmount <= 0) return { ok: false, message: "Amount must be positive" };
    if (lineItems.length === 0) return { ok: true, message: "" };

    const parsedLines = lineItems.map((li) => ({
      category: li.category,
      amount: Number(li.amount),
    }));

    if (parsedLines.some((li) => !Number.isFinite(li.amount))) {
      return { ok: false, message: "All line items need a numeric amount" };
    }

    if (txnType === "contribution") {
      const sum = parsedLines.reduce((s, li) => s + li.amount, 0);
      if (Math.abs(sum - parsedAmount) > 0.01) {
        return {
          ok: false,
          message: `Line items sum to $${sum.toFixed(2)} but amount is $${parsedAmount.toFixed(2)}`,
        };
      }
    } else if (txnType === "distribution") {
      const grossLines = parsedLines.filter((li) => li.category === "gross_distribution");
      if (grossLines.length === 0) {
        return { ok: false, message: "Distributions need at least one Gross Distribution line" };
      }
      const gross = grossLines.reduce((s, li) => s + li.amount, 0);
      const reductions = parsedLines
        .filter((li) => li.category !== "gross_distribution")
        .reduce((s, li) => s + li.amount, 0);
      const net = gross - reductions;
      if (Math.abs(net - parsedAmount) > 0.01) {
        return {
          ok: false,
          message: `Gross $${gross.toFixed(2)} − reductions $${reductions.toFixed(2)} = $${net.toFixed(2)}, but Net is $${parsedAmount.toFixed(2)}`,
        };
      }
    }

    return { ok: true, message: "" };
  }, [amount, lineItems, txnType, isAdjust]);

  const canSave = !!investorId && !!date && validation.ok && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setServerError(null);
    try {
      const newAmount = Number(amount);
      const newLineItems = lineItems.map((li) => ({
        category: li.category,
        amount: Number(li.amount),
        description: li.description || null,
      }));

      if (isEdit && editOriginal) {
        // PATCH the original row in place. Only send fields that actually
        // changed so the audit log diff is clean.
        const patch: Record<string, unknown> = { transaction_id: editOriginal.id };
        if (Math.abs(newAmount - Number(editOriginal.amount)) > 0.001) {
          patch.amount = newAmount;
        }
        if (date !== editOriginal.transaction_date) {
          patch.transaction_date = date;
        }
        if ((description || null) !== (editOriginal.description || null)) {
          patch.description = description || null;
        }
        // Always send line_items if the user has any, even if unchanged —
        // the diff between original and new could be subtle (re-ordering,
        // amount tweaks). Cheap to validate server-side.
        const originalLineItemsJson = JSON.stringify(editOriginal.line_items || []);
        const newLineItemsJson = JSON.stringify(newLineItems);
        if (originalLineItemsJson !== newLineItemsJson) {
          patch.line_items = newLineItems;
        }
        if (Object.keys(patch).length === 1) {
          // Only transaction_id present — nothing changed.
          setServerError("No changes to save");
          setSaving(false);
          return;
        }
        const res = await fetch(`/api/investments/${investmentId}/transactions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setServerError(err.error || "Failed to save");
          return;
        }
        onSaved();
        return;
      }

      if (isAdjust && adjustsOriginal) {
        // Compute delta vs the original. The user edited absolute values; we
        // store an adjustment row with the delta amount and per-category
        // delta line items. Server validator handles reconciliation.
        const deltaAmount = newAmount - Number(adjustsOriginal.amount);
        const originalLineItems: TransactionLineItem[] = adjustsOriginal.line_items || [];
        const origByCategory = new Map<string, number>();
        for (const li of originalLineItems) {
          origByCategory.set(li.category, (origByCategory.get(li.category) || 0) + Number(li.amount));
        }
        const newByCategory = new Map<string, number>();
        const newDescByCategory = new Map<string, string | null>();
        for (const li of newLineItems) {
          newByCategory.set(li.category, (newByCategory.get(li.category) || 0) + li.amount);
          if (!newDescByCategory.has(li.category)) newDescByCategory.set(li.category, li.description);
        }
        const allCats = new Set<string>([...origByCategory.keys(), ...newByCategory.keys()]);
        const deltaLineItems: Array<{ category: string; amount: number; description: string | null }> = [];
        for (const cat of allCats) {
          const delta = (newByCategory.get(cat) || 0) - (origByCategory.get(cat) || 0);
          if (Math.abs(delta) > 0.001) {
            deltaLineItems.push({
              category: cat,
              amount: Math.round(delta * 100) / 100,
              description: newDescByCategory.get(cat) || null,
            });
          }
        }

        if (Math.abs(deltaAmount) < 0.001 && deltaLineItems.length === 0) {
          setServerError("No changes to record. To fix a typo, use Edit instead of Record Amendment.");
          setSaving(false);
          return;
        }

        const body: Record<string, unknown> = {
          investment_investor_id: investorId,
          transaction_type: txnType,
          amount: Math.round(deltaAmount * 100) / 100,
          transaction_date: date,
          description: description || undefined,
          line_items: deltaLineItems,
          adjusts_transaction_id: adjustsOriginal.id,
          adjustment_reason: adjustmentReason || null,
        };
        const res = await fetch(`/api/investments/${investmentId}/transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setServerError(err.error || "Failed to save");
          return;
        }
        onSaved();
        return;
      }

      // CREATE mode — plain POST.
      const body: Record<string, unknown> = {
        investment_investor_id: investorId,
        transaction_type: txnType,
        amount: newAmount,
        transaction_date: date,
        description: description || undefined,
        line_items: newLineItems,
      };
      const res = await fetch(`/api/investments/${investmentId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setServerError(err.error || "Failed to save");
        return;
      }
      onSaved();
    } catch (err) {
      console.error(err);
      setServerError("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const cats = categoriesFor(txnType);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,20,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          maxWidth: 600,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          border: "1px solid #e8e6df",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: "#1a1a1f" }}>
              {isEdit ? "Edit Transaction" : isAdjust ? "Record Amendment" : "Record Transaction"}
            </h2>
            {isEdit && editOriginal && (
              <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 4 }}>
                Editing the original {editOriginal.transaction_type} row in place. Changes are audited.
              </div>
            )}
            {isAdjust && adjustsOriginal && (
              <div style={{ fontSize: 12, color: "#6b6b76", marginTop: 4 }}>
                Recording an after-the-fact amendment to the {adjustsOriginal.transaction_type} of $
                {Number(adjustsOriginal.amount).toLocaleString()} on {adjustsOriginal.transaction_date}.
                Use this for sponsor recalls or corrected wire amounts — NOT for typo fixes (use Edit on the row instead).
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9494a0", padding: 4 }}
            aria-label="Close"
          >
            <XIcon size={18} />
          </button>
        </div>

        {/* Investor */}
        {investors.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b6b76", display: "block", marginBottom: 4 }}>
              Investing Entity
            </label>
            <select
              value={investorId}
              onChange={(e) => setInvestorId(e.target.value)}
              disabled={isAdjust || isEdit}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid #ddd9d0", background: "#fff" }}
            >
              <option value="">Select investor...</option>
              {investors.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.entity_name || "Unknown"}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Transaction type */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#6b6b76", display: "block", marginBottom: 4 }}>Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            {(["contribution", "distribution", "return_of_capital"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTxnType(t)}
                disabled={isAdjust || isEdit}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid",
                  borderColor: txnType === t ? "#2d5a3d" : "#ddd9d0",
                  background: txnType === t ? "rgba(45,90,61,0.08)" : "#fff",
                  color: txnType === t ? "#2d5a3d" : "#6b6b76",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: (isAdjust || isEdit) ? "not-allowed" : "pointer",
                  opacity: (isAdjust || isEdit) ? 0.6 : 1,
                }}
              >
                {t === "return_of_capital" ? "Return of Capital" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Amount + Date */}
        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b6b76", display: "block", marginBottom: 4 }}>
              {txnType === "distribution" ? "Net Amount" : "Total Amount"}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid #ddd9d0", background: "#fff" }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b6b76", display: "block", marginBottom: 4 }}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid #ddd9d0", background: "#fff" }}
            />
          </div>
        </div>

        {/* Description */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#6b6b76", display: "block", marginBottom: 4 }}>Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={txnType === "distribution" ? "e.g., Distribution #11 (Q1 2025)" : "e.g., Capital call #3"}
            style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid #ddd9d0", background: "#fff" }}
          />
        </div>

        {/* Adjustment reason */}
        {isAdjust && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#6b6b76", display: "block", marginBottom: 4 }}>
              Adjustment Reason
            </label>
            <input
              type="text"
              value={adjustmentReason}
              onChange={(e) => setAdjustmentReason(e.target.value)}
              placeholder="e.g., Sponsor reduced call by $5,000"
              style={{ width: "100%", padding: "8px 12px", fontSize: 14, borderRadius: 8, border: "1px solid #ddd9d0", background: "#fff" }}
            />
          </div>
        )}

        {/* Line items */}
        {cats.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: "#f8f7f4", borderRadius: 8, border: "1px solid #e8e6df" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#6b6b76" }}>Line Items {showLineItems ? "" : "(optional)"}</span>
              {!showLineItems && lineItems.length === 0 && (
                <button
                  onClick={addLineItem}
                  style={{ background: "none", border: "1px solid #2d5a3d", color: "#2d5a3d", borderRadius: 6, padding: "3px 10px", fontSize: 11, cursor: "pointer" }}
                >
                  + Add line items
                </button>
              )}
            </div>
            {showLineItems && (
              <>
                {lineItems.map((li, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 6,
                      marginBottom: 6,
                      alignItems: "center",
                      width: "100%",
                    }}
                  >
                    <select
                      value={li.category}
                      onChange={(e) => updateLineItem(i, { category: e.target.value as TransactionLineItemCategory })}
                      style={{
                        flex: 2,
                        minWidth: 0,
                        padding: "6px 8px",
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #ddd9d0",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    >
                      {cats.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={li.amount}
                      onChange={(e) => updateLineItem(i, { amount: e.target.value })}
                      placeholder="0.00"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "6px 8px",
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #ddd9d0",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    />
                    <input
                      type="text"
                      value={li.description}
                      onChange={(e) => updateLineItem(i, { description: e.target.value })}
                      placeholder="(optional)"
                      style={{
                        flex: 2,
                        minWidth: 0,
                        padding: "6px 8px",
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #ddd9d0",
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      onClick={() => removeLineItem(i)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#9494a0",
                        cursor: "pointer",
                        fontSize: 14,
                        padding: 4,
                        flexShrink: 0,
                        width: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      aria-label="Remove line item"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addLineItem}
                  style={{ background: "none", border: "1px dashed #ddd9d0", color: "#6b6b76", borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer", width: "100%", marginTop: 4 }}
                >
                  + Add another line
                </button>
                {!validation.ok && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#c73e3e" }}>{validation.message}</div>
                )}
              </>
            )}
          </div>
        )}

        {serverError && (
          <div style={{ marginBottom: 12, padding: 10, background: "#fbe8e8", border: "1px solid #f4b8b8", borderRadius: 6, color: "#7a1818", fontSize: 12 }}>
            {serverError}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!canSave}>
            {saving
              ? "Saving..."
              : isEdit
                ? "Save Changes"
                : isAdjust
                  ? "Record Amendment"
                  : "Save Transaction"}
          </Button>
        </div>
      </div>
    </div>
  );
}
