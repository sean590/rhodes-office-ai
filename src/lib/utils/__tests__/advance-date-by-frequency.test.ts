/**
 * Regression test for advanceDateByFrequency — the ad-hoc obligation cycle
 * advance. This path replaced a synthesized-rule call that crashed on
 * `rule.due_date.type` (ad-hoc obligations have no due-date formula), which
 * surfaced as a 500 when completing a recurring ad-hoc compliance obligation.
 */

import { describe, it, expect } from "vitest";
import { advanceDateByFrequency } from "../compliance-engine";

describe("advanceDateByFrequency", () => {
  it("advances by the correct interval per frequency", () => {
    expect(advanceDateByFrequency("2026-04-15", "monthly")).toBe("2026-05-15");
    expect(advanceDateByFrequency("2026-04-15", "quarterly")).toBe("2026-07-15");
    expect(advanceDateByFrequency("2026-04-15", "semi_annual")).toBe("2026-10-15");
    expect(advanceDateByFrequency("2026-04-15", "annual")).toBe("2027-04-15");
    expect(advanceDateByFrequency("2026-04-15", "biennial")).toBe("2028-04-15");
    expect(advanceDateByFrequency("2026-04-15", "decennial")).toBe("2036-04-15");
  });

  it("rolls month/year over correctly", () => {
    expect(advanceDateByFrequency("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(advanceDateByFrequency("2026-12-15", "monthly")).toBe("2027-01-15");
  });

  it("returns null for non-recurring or unknown frequencies", () => {
    expect(advanceDateByFrequency("2026-04-15", "one_time")).toBeNull();
    expect(advanceDateByFrequency("2026-04-15", "continuous")).toBeNull();
    expect(advanceDateByFrequency("2026-04-15", "")).toBeNull();
    expect(advanceDateByFrequency("2026-04-15", "whatever")).toBeNull();
  });
});
