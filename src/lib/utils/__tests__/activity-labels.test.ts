import { describe, it, expect } from "vitest";
import { activityTitle } from "../activity-labels";

describe("activityTitle", () => {
  // ── Spec-listed cases from rhodes-activity-log-cleanup.md ────────────

  it("renders pipeline-item dismissals with filename", () => {
    expect(
      activityTitle("dismiss_extraction", "document", { document_name: "DE Franchise Tax 2025.pdf" }),
    ).toBe(`Dismissed DE Franchise Tax 2025.pdf from review`);
  });

  it("humanizes promoted pattern doc types via DOCUMENT_TYPE_LABELS", () => {
    expect(
      activityTitle("promote_pattern", "org_document_pattern", { document_type: "franchise_tax_payment" }),
    ).toMatch(/Promoted ".+" to a document requirement/);
  });

  it("renders pattern dismissals", () => {
    expect(
      activityTitle("dismiss_pattern", "org_document_pattern", { document_type: "annual_franchise_tax" }),
    ).toMatch(/Dismissed pattern: /);
  });

  it("labels state ID upserts with jurisdiction + entity", () => {
    expect(
      activityTitle("upsert_state_id", "entity_state_id", {
        jurisdiction: "DE",
        entity_name: "DG24 LLC",
      }),
    ).toBe("Updated DE state ID for DG24 LLC");
  });

  it("labels compliance obligation updates with name + entity", () => {
    expect(
      activityTitle("update_obligation", "compliance_obligation", {
        entity_name: "DG24 LLC",
        obligation_name: "DE Annual Report",
      }),
    ).toBe("Updated DE Annual Report for DG24 LLC");
  });

  it("labels document links with doc + entity", () => {
    expect(
      activityTitle("link", "document", {
        document_name: "2024 K-1.pdf",
        entity_name: "RCM Investments LLC",
      }),
    ).toBe("Linked 2024 K-1.pdf to RCM Investments LLC");
  });

  it("truncates entity edits when many fields change", () => {
    const fields = ["name", "entity_type", "formation_state", "ein", "address", "city", "state", "zip", "phone", "email", "website"];
    const result = activityTitle("edit", "entity", { entity_name: "LADD1, LLC", fields });
    expect(result).toContain("LADD1, LLC");
    expect(result).toMatch(/and \d+ more fields/);
  });

  it("keeps full field list when only a few changed", () => {
    const fields = ["name", "ein"];
    expect(
      activityTitle("edit", "entity", { entity_name: "Acme LLC", fields }),
    ).toBe("Updated Acme LLC (Name, Ein)");
  });

  // ── Suppression ──────────────────────────────────────────────────────

  it("returns null for internal pipeline batch chatter", () => {
    expect(activityTitle("create_batch", "pipeline", { file_count: 3 })).toBeNull();
    expect(activityTitle("process_batch", "pipeline", {})).toBeNull();
  });

  // ── Existing behaviors that must keep working ────────────────────────

  it("preserves the upload/pipeline filename display", () => {
    expect(
      activityTitle("upload", "pipeline", {
        file_count: 2,
        filenames: ["a.pdf", "b.pdf"],
      }),
    ).toBe("Uploaded 2 documents: a.pdf, b.pdf");
  });

  it("preserves transaction recording", () => {
    expect(
      activityTitle("create", "investment_transaction", { transaction_type: "capital_call", amount: 50000 }),
    ).toBe("Recorded capital call of $50,000");
  });

  // ── Generic fallback ─────────────────────────────────────────────────

  it("falls back to a readable phrase for unknown action+resource pairs", () => {
    expect(activityTitle("frobnicate", "widget", {})).toBe("Frobnicate widget");
    expect(activityTitle("frobnicate", "widget", { name: "test" })).toBe("Frobnicate: test");
  });
});
