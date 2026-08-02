/**
 * Tests for computeStaleObligations — the sync reconciliation that lets
 * catalog due-date corrections propagate without duplicating obligations.
 * See rhodes-compliance-data-integrity-spec.md §0b for the walk-through of
 * the duplicate-row bug this prevents.
 */

import { describe, it, expect } from "vitest";
import { computeStaleObligations } from "../compliance-sync";

const TODAY = "2026-08-02";

function pending(rule_id: string, next_due_date: string | null) {
  return { rule_id, next_due_date, status: "pending" };
}

describe("computeStaleObligations", () => {
  it("removes a future-dated pending row when the catalog corrected the date", () => {
    // Catalog said 2027-04-30; audit fixed it to 2027-06-30. The upsert
    // inserts the new row; the old one must be flagged stale.
    const existing = [pending("CA_LLC_SOI", "2027-04-30")];
    const generated = [{ rule_id: "CA_LLC_SOI", next_due_date: "2027-06-30" }];
    expect(computeStaleObligations(existing, generated, TODAY)).toEqual(existing);
  });

  it("keeps a future-dated pending row whose date still matches", () => {
    const existing = [pending("CA_LLC_SOI", "2027-06-30")];
    const generated = [{ rule_id: "CA_LLC_SOI", next_due_date: "2027-06-30" }];
    expect(computeStaleObligations(existing, generated, TODAY)).toEqual([]);
  });

  it("never touches an overdue pending row (past due date is user reality)", () => {
    // The engine only emits future dates, so a past-dated pending row is an
    // overdue filing the user still owes — a date correction must not eat it.
    const existing = [pending("CA_LLC_SOI", "2026-04-30")];
    const generated = [{ rule_id: "CA_LLC_SOI", next_due_date: "2027-06-30" }];
    expect(computeStaleObligations(existing, generated, TODAY)).toEqual([]);
  });

  it("removes pending rows whose rule no longer generates at all", () => {
    // The BOI case: rule emptied → all pending rows go, past or future dated.
    const existing = [
      pending("FED_ALL_BOI", "2026-01-01"),
      pending("FED_ALL_BOI", "2027-01-01"),
    ];
    expect(computeStaleObligations(existing, [], TODAY)).toEqual(existing);
  });

  it("never removes completed/exempt/not_applicable rows, even for dead rules", () => {
    const existing = [
      { rule_id: "FED_ALL_BOI", next_due_date: "2024-12-31", status: "completed" },
      { rule_id: "FED_ALL_BOI", next_due_date: "2025-01-01", status: "exempt" },
      { rule_id: "FED_ALL_BOI", next_due_date: "2025-01-01", status: "not_applicable" },
    ];
    expect(computeStaleObligations(existing, [], TODAY)).toEqual([]);
  });

  it("handles null next_due_date (continuous obligations) without removing on date mismatch", () => {
    // Continuous obligations carry null dates; they're only stale if the rule
    // itself stops generating.
    const existing = [pending("FED_ALL_EIN_CHANGE", null)];
    const generated = [{ rule_id: "FED_ALL_EIN_CHANGE", next_due_date: null }];
    expect(computeStaleObligations(existing, generated, TODAY)).toEqual([]);
  });

  it("end-to-end shape: correction yields exactly one pending row per rule", () => {
    // Simulates the post-upsert state the spec's acceptance describes: after
    // sync, existing = [old row, corrected row]; reconciliation removes only
    // the old one.
    const existing = [
      pending("CA_LLC_SOI", "2027-04-30"),
      pending("CA_LLC_SOI", "2027-06-30"),
    ];
    const generated = [{ rule_id: "CA_LLC_SOI", next_due_date: "2027-06-30" }];
    const stale = computeStaleObligations(existing, generated, TODAY);
    expect(stale).toEqual([pending("CA_LLC_SOI", "2027-04-30")]);
    const survivors = existing.filter((e) => !stale.includes(e));
    expect(survivors).toEqual([pending("CA_LLC_SOI", "2027-06-30")]);
  });
});
