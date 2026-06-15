import { describe, it, expect } from "vitest";
import { humanizeActivity, activityText, type RawActivity } from "../activity-humanizer";

/** Build a minimal RawActivity row for label assertions. */
function row(action: string, resource_type: string, metadata: Record<string, unknown>): RawActivity {
  return { id: "1", action, resource_type, metadata, created_at: "2026-06-01T00:00:00Z" };
}
const text = (a: string, rt: string, m: Record<string, unknown>) => activityText(row(a, rt, m));

describe("activity humanizer", () => {
  // ── Spec-listed cases ────────────────────────────────────────────────

  it("renders extraction dismissals with filename", () => {
    expect(text("dismiss_extraction", "document", { document_name: "DE Franchise Tax 2025.pdf" }))
      .toBe("Dismissed AI suggestions — DE Franchise Tax 2025.pdf");
  });

  it("humanizes promoted pattern doc types via DOCUMENT_TYPE_LABELS", () => {
    expect(text("promote_pattern", "org_document_pattern", { document_type: "franchise_tax_payment" }))
      .toMatch(/Promoted ".+" to a document requirement/);
  });

  it("renders pattern dismissals", () => {
    expect(text("dismiss_pattern", "org_document_pattern", { document_type: "annual_franchise_tax" }))
      .toMatch(/Dismissed pattern: /);
  });

  it("labels state ID upserts with jurisdiction + entity", () => {
    expect(text("upsert_state_id", "entity_state_id", { jurisdiction: "DE", entity_name: "DG24 LLC" }))
      .toBe("Updated DE state ID — DG24 LLC");
  });

  it("labels compliance obligation updates with name + entity", () => {
    expect(text("update_obligation", "compliance_obligation", { entity_name: "DG24 LLC", obligation_name: "DE Annual Report" }))
      .toBe("Updated DE Annual Report — DG24 LLC");
  });

  it("labels document links with doc + entity", () => {
    expect(text("link", "document", { document_name: "2024 K-1.pdf", entity_name: "RCM Investments LLC" }))
      .toBe("Linked 2024 K-1.pdf to RCM Investments LLC");
  });

  it("truncates entity edits when many fields change", () => {
    const fields = ["name", "entity_type", "formation_state", "ein", "address", "city", "state", "zip", "phone", "email", "website"];
    const result = text("edit", "entity", { entity_name: "LADD1, LLC", fields });
    expect(result).toContain("LADD1, LLC");
    expect(result).toMatch(/and \d+ more fields/);
  });

  it("keeps full field list when only a few changed, sentence-cased", () => {
    expect(text("edit", "entity", { entity_name: "Acme LLC", fields: ["tax_classification", "ein"] }))
      .toBe("Updated Acme LLC — Tax classification, Ein");
  });

  // ── Suppression ──────────────────────────────────────────────────────

  it("suppresses internal pipeline batch chatter", () => {
    expect(text("create_batch", "pipeline", { file_count: 3 })).toBeNull();
    expect(text("process_batch", "pipeline", {})).toBeNull();
    expect(humanizeActivity(row("create_batch", "pipeline", {})).suppressed).toBe(true);
  });

  // ── Existing behaviors that must keep working ────────────────────────

  it("preserves the upload/pipeline filename display", () => {
    expect(text("upload", "pipeline", { file_count: 2, filenames: ["a.pdf", "b.pdf"] }))
      .toBe("Uploaded 2 documents — a.pdf, b.pdf");
  });

  it("preserves transaction recording", () => {
    expect(text("create", "investment_transaction", { transaction_type: "capital_call", amount: 50000 }))
      .toBe("Recorded capital call of $50,000");
  });

  // ── Raw-code regression guards (the bugs that motivated consolidation) ─

  it("never leaks raw snake_case event codes", () => {
    expect(text("edit", "document", { document_name: "x.pdf" })).toBe("Edited document — x.pdf");
    expect(text("refresh", "document_expectation", { document_type: "services_agreement" }))
      .toBe("Refreshed required documents — Services Agreement");
    expect(text("upsert", "entity_state_id", { jurisdiction: "CA", entity_name: "Acme" }))
      .toBe("Updated CA state ID — Acme");
  });

  // ── Actor resolution ─────────────────────────────────────────────────

  it("resolves actor as You / teammate / Rhodes", () => {
    expect(humanizeActivity({ ...row("create", "entity", { name: "X" }), user_id: "u1" }, "u1").actor).toBe("you");
    expect(humanizeActivity({ ...row("create", "entity", { name: "X" }), user_id: "u2", user_name: "Sam" }, "u1").actorName).toBe("Sam");
    expect(humanizeActivity(row("create", "entity", { name: "X" })).actor).toBe("rhodes");
  });

  // ── Generic fallback ─────────────────────────────────────────────────

  it("falls back to a readable phrase for unknown action+resource pairs", () => {
    expect(text("frobnicate", "widget", {})).toBe("Frobnicate widget");
    expect(text("frobnicate", "widget", { name: "test" })).toBe("Frobnicate widget — test");
  });
});
