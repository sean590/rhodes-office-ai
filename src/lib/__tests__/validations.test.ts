import { describe, it, expect } from "vitest";
import {
  createEntitySchema,
  updateEntitySchema,
  chatMessageSchema,
  createBatchSchema,
  createRelationshipSchema,
  createDirectoryEntrySchema,
  createRegistrationSchema,
  createCapTableEntrySchema,
  entityPersonRefSchema,
  updateComplianceSchema,
  updateTrustDetailsSchema,
  createTrustRoleSchema,
  createEntityRoleSchema,
  createCustomFieldSchema,
  validateUploadedFile,
  validateInvestmentTransactionLineItems,
  coerceLineItemCategories,
  createInvestmentTransactionSchema,
} from "../validations";
import {
  deriveTotalsFromTransactions,
  type TransactionTotalRow,
} from "../utils/transaction-totals";

describe("createEntitySchema", () => {
  it("accepts valid entity", () => {
    const result = createEntitySchema.safeParse({
      name: "Test LLC",
      type: "llc",
      formation_state: "DE",
      short_name: "TEST",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = createEntitySchema.safeParse({
      type: "llc",
      formation_state: "DE",
      short_name: "TEST",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing short_name", () => {
    const result = createEntitySchema.safeParse({
      name: "Test LLC",
      type: "llc",
      formation_state: "DE",
    });
    expect(result.success).toBe(false);
  });

  it("validates EIN format", () => {
    const valid = createEntitySchema.safeParse({
      name: "Test LLC",
      type: "llc",
      formation_state: "DE",
      short_name: "TEST",
      ein: "12-3456789",
    });
    expect(valid.success).toBe(true);

    const invalid = createEntitySchema.safeParse({
      name: "Test LLC",
      type: "llc",
      formation_state: "DE",
      short_name: "TEST",
      ein: "invalid",
    });
    expect(invalid.success).toBe(false);
  });

  it("allows optional fields to be empty strings", () => {
    const result = createEntitySchema.safeParse({
      name: "Test LLC",
      type: "llc",
      formation_state: "DE",
      short_name: "TEST",
      ein: "",
      notes: "",
      address: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("updateEntitySchema", () => {
  it("allows partial updates", () => {
    const result = updateEntitySchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("validates status enum", () => {
    const valid = updateEntitySchema.safeParse({ status: "active" });
    expect(valid.success).toBe(true);

    const invalid = updateEntitySchema.safeParse({ status: "bogus" });
    expect(invalid.success).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  it("accepts valid message", () => {
    const result = chatMessageSchema.safeParse({
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      message: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = chatMessageSchema.safeParse({
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      message: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID session_id", () => {
    const result = chatMessageSchema.safeParse({
      session_id: "not-a-uuid",
      message: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional page_context", () => {
    const result = chatMessageSchema.safeParse({
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      message: "Hello",
      page_context: {
        page: "entity_detail",
        entityId: "123",
        entityName: "Test LLC",
      },
    });
    expect(result.success).toBe(true);
  });
});

describe("createRelationshipSchema", () => {
  it("accepts valid relationship", () => {
    const result = createRelationshipSchema.safeParse({
      type: "service_provider",
      from_entity_id: "550e8400-e29b-41d4-a716-446655440000",
      to_directory_id: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing type", () => {
    const result = createRelationshipSchema.safeParse({
      from_entity_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID", () => {
    const result = createRelationshipSchema.safeParse({
      type: "service_provider",
      from_entity_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});

describe("createDirectoryEntrySchema", () => {
  it("accepts valid entry", () => {
    const result = createDirectoryEntrySchema.safeParse({
      name: "John Doe",
      type: "individual",
    });
    expect(result.success).toBe(true);
  });

  it("accepts entry with email", () => {
    const result = createDirectoryEntrySchema.safeParse({
      name: "John Doe",
      type: "individual",
      email: "john@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = createDirectoryEntrySchema.safeParse({
      name: "John Doe",
      type: "individual",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("limits aliases array", () => {
    const result = createDirectoryEntrySchema.safeParse({
      name: "John Doe",
      type: "individual",
      aliases: Array(21).fill("alias"),
    });
    expect(result.success).toBe(false);
  });
});

describe("createRegistrationSchema", () => {
  it("accepts valid jurisdiction", () => {
    const result = createRegistrationSchema.safeParse({ jurisdiction: "DE" });
    expect(result.success).toBe(true);
  });

  it("rejects empty jurisdiction", () => {
    const result = createRegistrationSchema.safeParse({ jurisdiction: "" });
    expect(result.success).toBe(false);
  });
});

describe("createCapTableEntrySchema", () => {
  it("accepts valid entry", () => {
    const result = createCapTableEntrySchema.safeParse({
      investor_name: "Investor A",
      ownership_pct: 25.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects ownership over 100%", () => {
    const result = createCapTableEntrySchema.safeParse({
      ownership_pct: 101,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative ownership", () => {
    const result = createCapTableEntrySchema.safeParse({
      ownership_pct: -5,
    });
    expect(result.success).toBe(false);
  });
});

describe("entityPersonRefSchema", () => {
  it("accepts name only", () => {
    const result = entityPersonRefSchema.safeParse({ name: "Jane Doe" });
    expect(result.success).toBe(true);
  });

  it("accepts name with directory ref", () => {
    const result = entityPersonRefSchema.safeParse({
      name: "Jane Doe",
      directory_entry_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = entityPersonRefSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});

describe("updateComplianceSchema", () => {
  it("accepts valid status update", () => {
    const result = updateComplianceSchema.safeParse({
      status: "completed",
      completed_at: "2026-01-15",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateComplianceSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("updateTrustDetailsSchema", () => {
  it("accepts partial update", () => {
    const result = updateTrustDetailsSchema.safeParse({
      trust_type: "irrevocable",
      situs_state: "NV",
    });
    expect(result.success).toBe(true);
  });
});

describe("createTrustRoleSchema", () => {
  it("accepts valid role", () => {
    const result = createTrustRoleSchema.safeParse({
      role: "trustee",
      name: "John Smith",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing role", () => {
    const result = createTrustRoleSchema.safeParse({ name: "John Smith" });
    expect(result.success).toBe(false);
  });
});

describe("createEntityRoleSchema", () => {
  it("accepts valid role", () => {
    const result = createEntityRoleSchema.safeParse({
      role_title: "Secretary",
      name: "Jane Doe",
    });
    expect(result.success).toBe(true);
  });
});

describe("createCustomFieldSchema", () => {
  it("accepts valid field", () => {
    const result = createCustomFieldSchema.safeParse({
      label: "Tax ID",
      field_type: "text",
      value: "12345",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty label", () => {
    const result = createCustomFieldSchema.safeParse({
      label: "",
      field_type: "text",
    });
    expect(result.success).toBe(false);
  });
});

describe("validateUploadedFile", () => {
  it("accepts valid PDF", () => {
    const file = new File(["test"], "test.pdf", { type: "application/pdf" });
    expect(validateUploadedFile(file)).toEqual({ valid: true });
  });

  it("accepts valid image", () => {
    const file = new File(["test"], "test.png", { type: "image/png" });
    expect(validateUploadedFile(file)).toEqual({ valid: true });
  });

  it("rejects disallowed MIME type", () => {
    const file = new File(["test"], "test.exe", { type: "application/x-msdownload" });
    const result = validateUploadedFile(file);
    expect(result.valid).toBe(false);
  });

  it("rejects file over 50MB", () => {
    const bigContent = new Uint8Array(51 * 1024 * 1024);
    const file = new File([bigContent], "big.pdf", { type: "application/pdf" });
    const result = validateUploadedFile(file);
    expect(result.valid).toBe(false);
  });

  it("allows file with no MIME type", () => {
    const file = new File(["test"], "unknown", { type: "" });
    expect(validateUploadedFile(file)).toEqual({ valid: true });
  });
});

describe("createBatchSchema", () => {
  it("accepts minimal batch", () => {
    const result = createBatchSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts full batch", () => {
    const result = createBatchSchema.safeParse({
      name: "Q4 Batch",
      context: "entity",
      entity_id: "550e8400-e29b-41d4-a716-446655440000",
      entity_discovery: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid context", () => {
    const result = createBatchSchema.safeParse({ context: "invalid" });
    expect(result.success).toBe(false);
  });
});

// ============================================================
// Spec 036 — investment transaction line items
// ============================================================

describe("validateInvestmentTransactionLineItems", () => {
  it("accepts empty line_items (back-compat)", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "contribution",
      amount: 100000,
      line_items: [],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects contribution line items that don't sum to amount", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "contribution",
      amount: 128942.31,
      line_items: [
        { category: "subscription", amount: 112500, description: null },
        { category: "monitoring_fee", amount: 15000, description: null },
        // Missing audit_tax_expense; sums to 127500, not 128942.31
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a real Silverhawk-style contribution breakdown", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "contribution",
      amount: 128942.31,
      line_items: [
        { category: "subscription", amount: 112500, description: null },
        { category: "monitoring_fee", amount: 15000, description: null },
        { category: "audit_tax_expense", amount: 1442.31, description: null },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects subscription category under a distribution parent", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "distribution",
      amount: 100,
      line_items: [
        { category: "gross_distribution", amount: 100, description: null },
        { category: "subscription", amount: 0, description: null },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects gross_distribution under a contribution parent", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "contribution",
      amount: 100,
      line_items: [{ category: "gross_distribution", amount: 100, description: null }],
    });
    expect(r.ok).toBe(false);
  });

  it("requires at least one gross_distribution on a distribution", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "distribution",
      amount: 100,
      line_items: [{ category: "tax_withholding", amount: 100, description: null }],
    });
    expect(r.ok).toBe(false);
  });

  it("validates the gross - reductions = net rule for distributions", () => {
    // gross 16,109.31 - carried 3,221.86 = 12,887.45 net
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "distribution",
      amount: 12887.45,
      line_items: [
        { category: "gross_distribution", amount: 16109.31, description: null },
        { category: "carried_interest", amount: 3221.86, description: null },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects negative line item amounts on non-adjustment rows", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "contribution",
      amount: 100,
      line_items: [{ category: "subscription", amount: -100, description: null }],
    });
    expect(r.ok).toBe(false);
  });

  it("permits negative line item amounts on adjustment rows", () => {
    const r = validateInvestmentTransactionLineItems({
      transaction_type: "contribution",
      amount: -5000,
      line_items: [{ category: "subscription", amount: -5000, description: "Recall" }],
      adjusts_transaction_id: "a1b2c3d4-e5f6-4789-89ab-cdef01234567",
    });
    expect(r.ok).toBe(true);
  });
});

describe("coerceLineItemCategories", () => {
  it("coerces audit_tax_expense → compliance_holdback on a distribution", () => {
    const out = coerceLineItemCategories("distribution", [
      { category: "gross_distribution", amount: 24163.95, description: null },
      { category: "audit_tax_expense", amount: 461.10, description: "Audit/tax holdback" },
      { category: "carried_interest", amount: 4740.57, description: null },
    ]);
    expect(out[0].category).toBe("gross_distribution");
    expect(out[1].category).toBe("compliance_holdback");
    expect(out[1].amount).toBe(461.10);
    expect(out[1].description).toBe("Audit/tax holdback");
    expect(out[2].category).toBe("carried_interest");
  });

  it("coerces compliance_holdback → audit_tax_expense on a contribution", () => {
    const out = coerceLineItemCategories("contribution", [
      { category: "subscription", amount: 100000, description: null },
      { category: "compliance_holdback", amount: 1500, description: "Audit fee" },
    ]);
    expect(out[0].category).toBe("subscription");
    expect(out[1].category).toBe("audit_tax_expense");
  });

  it("does not touch correct categories", () => {
    const input = [
      { category: "gross_distribution" as const, amount: 1000, description: null },
      { category: "compliance_holdback" as const, amount: 100, description: null },
    ];
    const out = coerceLineItemCategories("distribution", input);
    expect(out).toEqual(input);
  });

  it("returns empty array unchanged", () => {
    expect(coerceLineItemCategories("distribution", [])).toEqual([]);
  });

  it("end-to-end: coerced distribution validates cleanly via the shared validator", () => {
    // Silverhawk row #15 shape: gross 24163.95, audit/tax 461.10, carry 4740.57, net 18962.28
    const coerced = coerceLineItemCategories("distribution", [
      { category: "gross_distribution", amount: 24163.95, description: null },
      { category: "audit_tax_expense", amount: 461.10, description: "Audit/tax holdback" },
      { category: "carried_interest", amount: 4740.57, description: null },
    ]);
    const result = validateInvestmentTransactionLineItems({
      transaction_type: "distribution",
      amount: 18962.28,
      line_items: coerced,
    });
    expect(result.ok).toBe(true);
  });
});

describe("createInvestmentTransactionSchema (spec 036)", () => {
  it("rejects negative amount on non-adjustment", () => {
    const r = createInvestmentTransactionSchema.safeParse({
      investment_investor_id: "a1b2c3d4-e5f6-4789-89ab-cdef01234567",
      transaction_type: "contribution",
      amount: -100,
      transaction_date: "2026-04-01",
    });
    expect(r.success).toBe(false);
  });

  it("permits negative amount on adjustment with line items", () => {
    const r = createInvestmentTransactionSchema.safeParse({
      investment_investor_id: "a1b2c3d4-e5f6-4789-89ab-cdef01234567",
      transaction_type: "contribution",
      amount: -5000,
      transaction_date: "2026-04-01",
      adjusts_transaction_id: "b2c3d4e5-f6a7-4890-9abc-def012345678",
      adjustment_reason: "Sponsor reduced call",
      line_items: [
        { category: "subscription", amount: -5000, description: null },
      ],
    });
    expect(r.success).toBe(true);
  });
});

describe("deriveTotalsFromTransactions (spec 036)", () => {
  it("only counts subscription lines toward called_capital", () => {
    const rows: TransactionTotalRow[] = [
      {
        transaction_type: "contribution",
        amount: 128942.31,
        line_items: [
          { category: "subscription", amount: 112500, description: null },
          { category: "monitoring_fee", amount: 15000, description: null },
          { category: "audit_tax_expense", amount: 1442.31, description: null },
        ],
        adjusts_transaction_id: null,
      },
    ];
    const t = deriveTotalsFromTransactions(rows);
    expect(t.total_contributed).toBeCloseTo(128942.31, 2);
    expect(t.called_capital).toBeCloseTo(112500, 2);
  });

  it("falls back to 100% subscription on contributions with empty line_items", () => {
    const rows: TransactionTotalRow[] = [
      { transaction_type: "contribution", amount: 50000, line_items: [], adjusts_transaction_id: null },
    ];
    const t = deriveTotalsFromTransactions(rows);
    expect(t.total_contributed).toBe(50000);
    expect(t.called_capital).toBe(50000);
    expect(t.contribution_fallback_count).toBe(1);
  });

  it("derives gross and net distribution totals from line items", () => {
    const rows: TransactionTotalRow[] = [
      {
        transaction_type: "distribution",
        amount: 12887.45,
        line_items: [
          { category: "gross_distribution", amount: 16109.31, description: null },
          { category: "carried_interest", amount: 3221.86, description: null },
        ],
        adjusts_transaction_id: null,
      },
    ];
    const t = deriveTotalsFromTransactions(rows);
    expect(t.total_distributed_gross).toBeCloseTo(16109.31, 2);
    expect(t.total_distributed_net).toBeCloseTo(12887.45, 2);
  });

  it("falls back to gross == net when distribution line_items are empty", () => {
    const rows: TransactionTotalRow[] = [
      { transaction_type: "distribution", amount: 8000, line_items: [], adjusts_transaction_id: null },
    ];
    const t = deriveTotalsFromTransactions(rows);
    expect(t.total_distributed_gross).toBe(8000);
    expect(t.total_distributed_net).toBe(8000);
  });

  it("an adjustment with a negative subscription line reduces called_capital", () => {
    const rows: TransactionTotalRow[] = [
      {
        transaction_type: "contribution",
        amount: 100000,
        line_items: [{ category: "subscription", amount: 100000, description: null }],
        adjusts_transaction_id: null,
      },
      {
        transaction_type: "contribution",
        amount: -5000,
        line_items: [{ category: "subscription", amount: -5000, description: null }],
        adjusts_transaction_id: "a1b2c3d4-e5f6-4789-89ab-cdef01234567",
      },
    ];
    const t = deriveTotalsFromTransactions(rows);
    expect(t.total_contributed).toBe(95000);
    expect(t.called_capital).toBe(95000);
  });
});
