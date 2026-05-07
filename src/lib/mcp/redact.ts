/**
 * Sensitive-field redaction for MCP tool results.
 *
 * Every tool result passes through this before being handed to Claude. The
 * security model treats redaction as non-negotiable in Phase 1 — values
 * leaked into the cached prefix or chat history cannot be retrieved.
 *
 * See `rhodes-mcp-tool-architecture-spec.md` → Security Model →
 * Sensitive-field redaction.
 */

export const SENSITIVE_FIELDS_FULL_REDACT = [
  "ssn",
  "tax_id",
  "bank_account_number",
  "routing_number",
  "date_of_birth",
  "home_address",
  "driver_license_number",
  "passport_number",
] as const;

export const SENSITIVE_FIELDS_LAST_4 = ["ein"] as const;

const FULL_SET: ReadonlySet<string> = new Set(SENSITIVE_FIELDS_FULL_REDACT);
const LAST4_SET: ReadonlySet<string> = new Set(SENSITIVE_FIELDS_LAST_4);

const REDACTED = "[REDACTED]";

export interface RedactOptions {
  /** Field names to opt OUT of redaction for this call (Phase 2 reveal flag). */
  reveal?: readonly string[];
}

function maskLast4(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return REDACTED;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return REDACTED;
  const last4 = digits.slice(-4);
  // EIN format: XX-XXXXXXX (9 digits). Output preserves the conventional
  // "XX-XXX" prefix so downstream display is not surprised by a new shape.
  return `XX-XXX${last4}`;
}

/**
 * Returns a new object tree with sensitive fields replaced. Idempotent:
 * running twice is safe and produces the same output.
 */
export function redact<T>(obj: T, options: RedactOptions = {}): T {
  const revealed: ReadonlySet<string> = new Set(options.reveal ?? []);
  return walk(obj, revealed) as T;
}

function walk(node: unknown, revealed: ReadonlySet<string>): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((n) => walk(n, revealed));
  if (typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (revealed.has(key)) {
      out[key] = value;
      continue;
    }
    if (FULL_SET.has(key)) {
      out[key] = value === null || value === undefined ? value : REDACTED;
      continue;
    }
    if (LAST4_SET.has(key)) {
      out[key] = value === null || value === undefined ? value : maskLast4(value);
      continue;
    }
    out[key] = walk(value, revealed);
  }
  return out;
}
