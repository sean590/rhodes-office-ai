import { describe, it, expect } from "vitest";
import { deriveCalledCapitalByKey, deriveCalledCapitalByInvestor } from "../transaction-totals";

// Minimal row shape for the grouping logic (only fields it reads).
const row = (over: Record<string, unknown>) => ({
  transaction_type: "contribution",
  amount: 0,
  line_items: [],
  adjusts_transaction_id: null,
  transaction_date: "2025-01-01",
  ...over,
});

describe("deriveCalledCapitalByKey", () => {
  it("groups called capital by an arbitrary participant key (cap_table_entry_id)", () => {
    const rows = [
      row({ cap_table_entry_id: "A", amount: 700_000 }),
      row({ cap_table_entry_id: "B", amount: 350_000 }),
      row({ cap_table_entry_id: "A", amount: 120_000 }),
    ];
    expect(deriveCalledCapitalByKey(rows, "cap_table_entry_id")).toEqual({ A: 820_000, B: 350_000 });
  });

  it("skips rows whose key is null (unattributed)", () => {
    const rows = [
      row({ cap_table_entry_id: "A", amount: 100 }),
      row({ cap_table_entry_id: null, amount: 999 }),
    ];
    expect(deriveCalledCapitalByKey(rows, "cap_table_entry_id")).toEqual({ A: 100 });
  });

  it("only counts contributions (distributions/RoC don't add called capital)", () => {
    const rows = [
      row({ cap_table_entry_id: "A", amount: 100, transaction_type: "contribution" }),
      row({ cap_table_entry_id: "A", amount: 50, transaction_type: "distribution" }),
    ];
    expect(deriveCalledCapitalByKey(rows, "cap_table_entry_id")).toEqual({ A: 100 });
  });

  it("uses the subscription line item when present, else falls back to full amount", () => {
    const rows = [
      row({ cap_table_entry_id: "A", amount: 100, line_items: [{ category: "subscription", amount: 60 }, { category: "management_fee", amount: 40 }] }),
      row({ cap_table_entry_id: "B", amount: 200, line_items: [] }),
    ];
    expect(deriveCalledCapitalByKey(rows, "cap_table_entry_id")).toEqual({ A: 60, B: 200 });
  });

  it("the investor-keyed helper is the same logic keyed by investment_investor_id", () => {
    const rows = [row({ investment_investor_id: "X", amount: 500 })];
    expect(deriveCalledCapitalByInvestor(rows)).toEqual({ X: 500 });
  });
});
