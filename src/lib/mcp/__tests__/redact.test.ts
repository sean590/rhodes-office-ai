import { describe, it, expect } from "vitest";
import {
  redact,
  SENSITIVE_FIELDS_FULL_REDACT,
  SENSITIVE_FIELDS_LAST_4,
} from "../redact";

describe("redact — full-redaction catalog", () => {
  for (const field of SENSITIVE_FIELDS_FULL_REDACT) {
    it(`redacts ${field} at the top level`, () => {
      const input = { [field]: "sensitive-value", other: "ok" };
      const out = redact(input) as Record<string, unknown>;
      expect(out[field]).toBe("[REDACTED]");
      expect(out.other).toBe("ok");
    });
  }

  it("preserves null/undefined sensitive fields without replacing them", () => {
    const out = redact({ ssn: null, tax_id: undefined }) as Record<string, unknown>;
    expect(out.ssn).toBeNull();
    expect(out.tax_id).toBeUndefined();
  });
});

describe("redact — last-4 catalog", () => {
  for (const field of SENSITIVE_FIELDS_LAST_4) {
    it(`masks ${field} showing only last 4 digits`, () => {
      const out = redact({ [field]: "12-3456789" }) as Record<string, unknown>;
      expect(out[field]).toBe("XX-XXX6789");
    });
  }

  it("falls back to [REDACTED] when a masked field has fewer than 4 digits", () => {
    const out = redact({ ein: "12" }) as Record<string, unknown>;
    expect(out.ein).toBe("[REDACTED]");
  });

  it("preserves null EIN", () => {
    const out = redact({ ein: null }) as Record<string, unknown>;
    expect(out.ein).toBeNull();
  });
});

describe("redact — nested objects and arrays", () => {
  it("traverses nested objects", () => {
    const input = {
      entity: {
        name: "Acme",
        ein: "12-3456789",
        owner: {
          ssn: "111-22-3333",
          name: "Owner",
        },
      },
    };
    const out = redact(input) as {
      entity: { name: string; ein: string; owner: { ssn: string; name: string } };
    };
    expect(out.entity.ein).toBe("XX-XXX6789");
    expect(out.entity.owner.ssn).toBe("[REDACTED]");
    expect(out.entity.name).toBe("Acme");
    expect(out.entity.owner.name).toBe("Owner");
  });

  it("traverses arrays of objects", () => {
    const input = {
      members: [
        { name: "A", ssn: "111" },
        { name: "B", ein: "98-7654321" },
      ],
    };
    const out = redact(input) as { members: Array<Record<string, unknown>> };
    expect(out.members[0].ssn).toBe("[REDACTED]");
    expect(out.members[1].ein).toBe("XX-XXX4321");
    expect(out.members[0].name).toBe("A");
  });

  it("is idempotent", () => {
    const input = { ssn: "secret", ein: "12-3456789" };
    const once = redact(input);
    const twice = redact(once);
    expect(twice).toEqual(once);
  });
});

describe("redact — reveal allowlist", () => {
  it("opts specific fields out of redaction", () => {
    const input = { ein: "12-3456789", ssn: "111-22-3333" };
    const out = redact(input, { reveal: ["ein"] }) as Record<string, unknown>;
    expect(out.ein).toBe("12-3456789");
    expect(out.ssn).toBe("[REDACTED]");
  });

  it("applies reveal recursively through nesting", () => {
    const input = { entity: { ein: "12-3456789", ssn: "111" } };
    const out = redact(input, { reveal: ["ein"] }) as {
      entity: { ein: string; ssn: string };
    };
    expect(out.entity.ein).toBe("12-3456789");
    expect(out.entity.ssn).toBe("[REDACTED]");
  });

  it("leaves non-sensitive fields untouched whether or not revealed", () => {
    const input = { name: "Acme" };
    expect(redact(input, { reveal: ["name"] })).toEqual({ name: "Acme" });
    expect(redact(input)).toEqual({ name: "Acme" });
  });
});
