/**
 * Engine tests for the federal-rules behavior added in the federal compliance
 * spec. These call generateComplianceObligations directly against the real
 * COMPLIANCE_RULES list (no mocks) so we know the rule wiring works.
 *
 * Existing state-rule tests aren't covered here — those are exercised through
 * compliance-smoke.test.ts via mocks of the generator.
 */

import { describe, it, expect } from "vitest";
import { generateComplianceObligations } from "../compliance-engine";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";

function baseEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTITY_ID,
    status: "active",
    type: "operating_company",
    legal_structure: "llc" as const,
    tax_classification: null,
    formation_state: "DE",
    formed_date: "2020-01-01",
    registrations: [],
    ...overrides,
  };
}

describe("generateComplianceObligations — federal rules", () => {
  it("generates Form 1120 + 1120-W for a C-corp-elected LLC", async () => {
    const result = generateComplianceObligations(
      baseEntity({ tax_classification: "c_corp" }),
    );
    const ruleIds = result.map((o) => o.rule_id);
    expect(ruleIds).toContain("FED_CCORP_1120");
    expect(ruleIds).toContain("FED_CCORP_EST_TAX");
    // The form-1120 obligation has the right shape
    const f1120 = result.find((o) => o.rule_id === "FED_CCORP_1120");
    expect(f1120?.form_number).toBe("1120");
    expect(f1120?.jurisdiction).toBe("federal");
  });

  it("generates Form 1065 for a partnership-elected entity", async () => {
    const result = generateComplianceObligations(
      baseEntity({ tax_classification: "partnership" }),
    );
    const ruleIds = result.map((o) => o.rule_id);
    expect(ruleIds).toContain("FED_PARTNERSHIP_1065");
    expect(ruleIds).not.toContain("FED_CCORP_1120");
    expect(ruleIds).not.toContain("FED_SCORP_1120S");
  });

  it("generates Form 1120-S for an S-corp-elected entity", async () => {
    const result = generateComplianceObligations(
      baseEntity({ tax_classification: "s_corp" }),
    );
    expect(result.map((o) => o.rule_id)).toContain("FED_SCORP_1120S");
  });

  it("generates Form 1041 for non-grantor trusts", async () => {
    const result = generateComplianceObligations(
      baseEntity({
        type: "trust",
        legal_structure: "non_grantor_trust",
        tax_classification: "trust_non_grantor",
      }),
    );
    expect(result.map((o) => o.rule_id)).toContain("FED_TRUST_1041");
  });

  it("generates zero federal income-tax rules when tax_classification is null on a non-person", async () => {
    const result = generateComplianceObligations(baseEntity());
    const fedIncomeIds = result
      .filter((o) => o.jurisdiction === "federal" && o.obligation_type === "federal_income_tax")
      .map((o) => o.rule_id);
    expect(fedIncomeIds).toEqual([]);
  });

  it("generates BOI for an LLC even without tax_classification", async () => {
    // BOI is keyed on entity_types only, not tax_classifications.
    const result = generateComplianceObligations(baseEntity());
    expect(result.map((o) => o.rule_id)).toContain("FED_ALL_BOI");
  });

  it("generates 1040 + 1040-ES for a person entity with no tax_classification", async () => {
    // Person entities default to sole_prop in the engine.
    const result = generateComplianceObligations(
      baseEntity({
        type: "person",
        legal_structure: null,
        formation_state: "CA",
        tax_classification: null,
      }),
    );
    const ruleIds = result.map((o) => o.rule_id);
    expect(ruleIds).toContain("FED_PERSON_1040");
    expect(ruleIds).toContain("FED_PERSON_EST_TAX");
  });

  it("does not generate 1040 for a non-person entity even with sole_prop classification", async () => {
    // Sole_prop classification on an LLC shouldn't pull in person-scoped rules.
    const result = generateComplianceObligations(
      baseEntity({ tax_classification: "sole_prop" }),
    );
    expect(result.map((o) => o.rule_id)).not.toContain("FED_PERSON_1040");
  });

  it("preserves existing state rule matching unchanged", async () => {
    // A DE LLC should still get the DE annual franchise tax obligation that
    // existed before federal rules were added. This guards against regressions.
    const result = generateComplianceObligations(baseEntity());
    const deRules = result.filter((o) => o.jurisdiction === "DE");
    expect(deRules.length).toBeGreaterThan(0);
  });

  it("returns empty for non-active entities regardless of tax_classification", async () => {
    const result = generateComplianceObligations(
      baseEntity({ tax_classification: "c_corp", status: "dissolved" }),
    );
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// State personal income tax + PTET (PR 2 rules)
// ═══════════════════════════════════════════════════════════════════

describe("generateComplianceObligations — state personal income tax", () => {
  it("CA person entity gets Form 540 + federal 1040/1040-ES", async () => {
    const result = generateComplianceObligations(
      baseEntity({ type: "person", legal_structure: null, formation_state: "CA" }),
    );
    const ruleIds = result.map((o) => o.rule_id);
    expect(ruleIds).toContain("CA_PERSON_540");
    expect(ruleIds).toContain("FED_PERSON_1040");
    expect(ruleIds).toContain("FED_PERSON_EST_TAX");
  });

  it("NY person entity gets IT-201", async () => {
    const result = generateComplianceObligations(
      baseEntity({ type: "person", legal_structure: null, formation_state: "NY" }),
    );
    expect(result.map((o) => o.rule_id)).toContain("NY_PERSON_IT201");
  });

  it("FL person entity gets the informational no-income-tax entry (not 540)", async () => {
    const result = generateComplianceObligations(
      baseEntity({ type: "person", legal_structure: null, formation_state: "FL" }),
    );
    const ruleIds = result.map((o) => o.rule_id);
    expect(ruleIds).toContain("FL_PERSON_NO_INCOME_TAX");
    expect(ruleIds).not.toContain("CA_PERSON_540");
    expect(ruleIds).not.toContain("NY_PERSON_IT201");
  });

  it("LLC entities don't get person income tax rules", async () => {
    const result = generateComplianceObligations(
      baseEntity({ formation_state: "CA", tax_classification: "partnership" }),
    );
    expect(result.map((o) => o.rule_id)).not.toContain("CA_PERSON_540");
  });
});

describe("generateComplianceObligations — PTET", () => {
  it("CA partnership-elected LLC gets CA PTET obligation", async () => {
    const result = generateComplianceObligations(
      baseEntity({ formation_state: "CA", tax_classification: "partnership" }),
    );
    expect(result.map((o) => o.rule_id)).toContain("CA_PTET");
  });

  it("CA c-corp doesn't get PTET (only partnership / s_corp elections)", async () => {
    const result = generateComplianceObligations(
      baseEntity({ formation_state: "CA", tax_classification: "c_corp" }),
    );
    expect(result.map((o) => o.rule_id)).not.toContain("CA_PTET");
  });

  it("NY S-corp LLC gets NY PTET obligation", async () => {
    const result = generateComplianceObligations(
      baseEntity({ formation_state: "NY", tax_classification: "s_corp" }),
    );
    expect(result.map((o) => o.rule_id)).toContain("NY_PTET");
  });
});
