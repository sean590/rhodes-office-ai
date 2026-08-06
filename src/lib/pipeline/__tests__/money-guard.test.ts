import { describe, it, expect } from "vitest";
import {
  assertPlausibleMoney,
  impliedCapTableTotal,
  exceedsAnchor,
  MoneyError,
  MAX_MONEY_USD,
} from "../money-guard";

describe("assertPlausibleMoney", () => {
  it("accepts whole-dollar amounts, incl. large legit ones", () => {
    for (const v of [0, 350000, 700000, 6_522_260, 250_000_000]) {
      expect(() => assertPlausibleMoney(v, "capital")).not.toThrow();
    }
  });

  it("is a no-op for null/undefined (optional fields)", () => {
    expect(() => assertPlausibleMoney(null)).not.toThrow();
    expect(() => assertPlausibleMoney(undefined)).not.toThrow();
  });

  it("rejects non-integer (cents), negative, and non-finite", () => {
    expect(() => assertPlausibleMoney(350000.5, "capital")).toThrow(MoneyError);
    expect(() => assertPlausibleMoney(-1, "capital")).toThrow(MoneyError);
    expect(() => assertPlausibleMoney(NaN, "capital")).toThrow(MoneyError);
    expect(() => assertPlausibleMoney(Infinity, "capital")).toThrow(MoneyError);
  });

  it("rejects amounts above the absolute sanity ceiling", () => {
    expect(() => assertPlausibleMoney(MAX_MONEY_USD + 1, "capital")).toThrow(/sanity ceiling/);
  });
});

describe("cap-table anchor reconciliation", () => {
  it("implied total = capital / ownership fraction", () => {
    // The 909 Park bug: $70M at 40% implies a $175M total.
    expect(impliedCapTableTotal(70_000_000, 40)).toBe(175_000_000);
    // Corrected: $700k at 40% implies $1.75M.
    expect(impliedCapTableTotal(700_000, 40)).toBe(1_750_000);
  });

  it("returns null when ownership is missing or zero", () => {
    expect(impliedCapTableTotal(70_000_000, 0)).toBeNull();
    expect(impliedCapTableTotal(70_000_000, null)).toBeNull();
    expect(impliedCapTableTotal(null, 40)).toBeNull();
  });

  it("flags a 100x error against the entity's real invested capital", () => {
    // 909 Park: implied $175M vs the investment's real $2.275M committed → ~77x.
    expect(exceedsAnchor(175_000_000, 2_275_000)).toBe(true);
  });

  it("does NOT flag the corrected value against the same anchor", () => {
    expect(exceedsAnchor(1_750_000, 2_275_000)).toBe(false);
  });

  it("has no opinion when there's no usable anchor (never a false positive)", () => {
    expect(exceedsAnchor(175_000_000, 0)).toBe(false);
    expect(exceedsAnchor(175_000_000, null)).toBe(false);
    expect(exceedsAnchor(null, 2_275_000)).toBe(false);
  });
});
