import { describe, it, expect } from "vitest";
import { sweepWindows } from "@/app/api/cron/expiry-sweep/route";

describe("expiry-sweep windows", () => {
  const now = new Date("2026-08-06T03:00:00.000Z");
  const w = sweepWindows(now);

  it("selection cutoffs are 30 days before now", () => {
    expect(w.expiryCutoff).toBe("2026-07-07T03:00:00.000Z");
    expect(w.cancelCutoff).toBe("2026-07-07T03:00:00.000Z");
  });

  it("hard-delete is scheduled with a 1-day final buffer after soft-delete", () => {
    expect(w.scheduledFor).toBe("2026-08-07T03:00:00.000Z");
  });

  it("a trial that ended exactly 30 days ago is at the cutoff boundary (selected: < cutoff is stricter)", () => {
    // A trial_ends_at strictly before the cutoff is swept; 30-days-ago-exactly is the edge.
    const endedJustOver30d = new Date("2026-07-07T02:59:59.000Z").toISOString();
    expect(endedJustOver30d < w.expiryCutoff).toBe(true);
    const ended29d = new Date("2026-07-08T03:00:00.000Z").toISOString();
    expect(ended29d < w.expiryCutoff).toBe(false);
  });
});
