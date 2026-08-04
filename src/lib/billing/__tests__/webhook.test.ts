import { describe, it, expect } from "vitest";
import { mapSubStatus } from "../webhook";

describe("mapSubStatus", () => {
  it("active/trialing map through", () => {
    expect(mapSubStatus("active")).toBe("active");
    expect(mapSubStatus("trialing")).toBe("trialing");
  });
  it("dunning states → past_due", () => {
    for (const s of ["past_due", "unpaid", "incomplete", "paused"] as const) {
      expect(mapSubStatus(s)).toBe("past_due");
    }
  });
  it("terminal states → canceled", () => {
    expect(mapSubStatus("canceled")).toBe("canceled");
    expect(mapSubStatus("incomplete_expired")).toBe("canceled");
  });
});
