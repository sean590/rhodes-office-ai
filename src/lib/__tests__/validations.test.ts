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
} from "../validations";

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
