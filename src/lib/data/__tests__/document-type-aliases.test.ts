import { describe, it, expect } from "vitest";
import { documentTypeSatisfies } from "../document-type-aliases";

describe("documentTypeSatisfies", () => {
  it("matches aliased types (franchise tax)", () => {
    expect(documentTypeSatisfies("annual_franchise_tax", "franchise_tax_payment")).toBe(true);
    expect(documentTypeSatisfies("annual_franchise_tax", "state_tax_payment")).toBe(true);
    expect(documentTypeSatisfies("franchise_tax_report", "franchise_tax_payment")).toBe(true);
  });

  it("matches exact type equality", () => {
    expect(documentTypeSatisfies("annual_franchise_tax", "annual_franchise_tax")).toBe(true);
    expect(documentTypeSatisfies("operating_agreement", "operating_agreement")).toBe(true);
  });

  it("is one-directional — alias values don't accept the key", () => {
    // franchise_tax_payment is a VALUE in the alias map; an expectation
    // for franchise_tax_payment is not satisfied by annual_franchise_tax.
    expect(documentTypeSatisfies("franchise_tax_payment", "annual_franchise_tax")).toBe(false);
  });

  it("returns false for unrelated types", () => {
    expect(documentTypeSatisfies("operating_agreement", "k1")).toBe(false);
    expect(documentTypeSatisfies("ein_letter", "bylaws")).toBe(false);
  });

  it("handles federal tax return form-number aliases", () => {
    expect(documentTypeSatisfies("federal_tax_return", "tax_return_1065")).toBe(true);
    expect(documentTypeSatisfies("federal_tax_return", "tax_return_1120s")).toBe(true);
    expect(documentTypeSatisfies("federal_tax_return", "tax_return_1041")).toBe(true);
    expect(documentTypeSatisfies("federal_tax_return", "tax_return_1040")).toBe(true);
    expect(documentTypeSatisfies("federal_tax_return", "state_tax_payment")).toBe(false);
  });

  it("supports bidirectional formation-document aliases", () => {
    // Declared in both directions in the alias map so either naming works.
    expect(documentTypeSatisfies("certificate_of_formation", "articles_of_organization")).toBe(true);
    expect(documentTypeSatisfies("articles_of_organization", "certificate_of_formation")).toBe(true);
  });
});
