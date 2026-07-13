/**
 * home-action-fields — maps a staged MCP action (tool + input) to the editable
 * fields shown in the Home Review sheet. apply-actions re-validates input, so a
 * changed field is honoured on approve.
 *
 * Known tools get a curated field list (right labels, dropdowns for *_id refs,
 * typed controls). Unknown tools fall back to a conservative generic editor that
 * never blindly edits a UUID. Field key names mirror the Zod input schemas in
 * src/lib/mcp/tools/*.
 */

import type { SheetField } from "@/components/home/ReviewSheet";

const DOC_CATEGORY = ["formation", "tax", "investor", "contracts", "compliance", "insurance", "governance", "other"];

const TOOL_FIELDS: Record<string, SheetField[]> = {
  record_investment_transaction: [
    { key: "transaction_type", label: "Type", type: "enum", enumValues: ["contribution", "distribution", "return_of_capital"] },
    { key: "amount", label: "Amount", type: "money" },
    { key: "transaction_date", label: "Date", type: "date" },
    { key: "investment_id", label: "Investment", type: "investment" },
    { key: "parent_entity_id", label: "Investor entity", type: "entity" },
    { key: "document_id", label: "Document", type: "document" },
    { key: "description", label: "Description", type: "text" },
  ],
  update_investment_transaction: [
    { key: "transaction_type", label: "Type", type: "enum", enumValues: ["contribution", "distribution"] },
    { key: "amount", label: "Amount", type: "money" },
    { key: "transaction_date", label: "Date", type: "date" },
    { key: "document_id", label: "Document", type: "document" },
    { key: "notes", label: "Notes", type: "text" },
  ],
  update_document: [
    { key: "document_id", label: "Document", type: "document" },
    { key: "name", label: "Name", type: "text" },
    { key: "document_type", label: "Document type", type: "text" },
    { key: "document_category", label: "Category", type: "enum", enumValues: DOC_CATEGORY },
    { key: "year", label: "Year", type: "year" },
    { key: "jurisdiction", label: "State", type: "text" },
  ],
  link_document_to_entity: [
    { key: "document_id", label: "Document", type: "document" },
    { key: "entity_id", label: "Entity", type: "entity" },
  ],
  link_document_to_investment: [
    { key: "document_id", label: "Document", type: "document" },
    { key: "investment_id", label: "Investment", type: "investment" },
  ],
  create_compliance_obligation: [
    { key: "name", label: "Name", type: "text" },
    { key: "obligation_type", label: "Type", type: "text" },
    { key: "jurisdiction", label: "Jurisdiction", type: "text" },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "recurrence", label: "Recurrence", type: "enum", enumValues: ["annual", "quarterly", "monthly", "one_time"] },
    { key: "entity_id", label: "Entity", type: "entity" },
  ],
  create_investment: [
    { key: "name", label: "Name", type: "text" },
    { key: "investment_type", label: "Type", type: "enum", enumValues: ["real_estate", "startup", "fund", "private_equity", "debt", "other"] },
    { key: "committed_capital", label: "Committed capital", type: "money" },
    { key: "parent_entity_id", label: "Initial investor", type: "entity" },
  ],
};

function humanLabel(k: string): string {
  return k.replace(/_id$/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// Known reference ids we CAN resolve to a human name (so they're shown, not hidden).
const REF_FIELD: Record<string, SheetField> = {
  entity_id: { key: "entity_id", label: "Entity", type: "entity" },
  parent_entity_id: { key: "parent_entity_id", label: "Investor entity", type: "entity" },
  investment_id: { key: "investment_id", label: "Investment", type: "investment" },
  document_id: { key: "document_id", label: "Document", type: "document" },
};

/** Editable fields for a staged action. Curated where known, conservative-generic otherwise. */
export function fieldsForAction(tool: string, input: Record<string, unknown>): SheetField[] {
  if (TOOL_FIELDS[tool]) return TOOL_FIELDS[tool];

  // Generic fallback: scalar values we can safely edit, plus any reference id we
  // know how to resolve to a name (shown for context — never a raw UUID). Unknown
  // *_id refs and nested structures are skipped (no blind UUID edits, no editors).
  const out: SheetField[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (REF_FIELD[k]) { out.push(REF_FIELD[k]); continue; }
    if (k.endsWith("_id") || v === null || typeof v === "object" || typeof v === "boolean") continue;
    if (typeof v === "number") {
      out.push({ key: k, label: humanLabel(k), type: /amount|capital|payment|pct/.test(k) ? "money" : /year/.test(k) ? "year" : "number" });
    } else if (/date/.test(k)) {
      out.push({ key: k, label: humanLabel(k), type: "date" });
    } else {
      out.push({ key: k, label: humanLabel(k), type: "text" });
    }
  }
  return out;
}
