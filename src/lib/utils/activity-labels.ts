/**
 * Human-readable titles for audit log entries.
 *
 * Used by both the dashboard Recent Activity feed (activity-entry.tsx) and
 * the Settings → Activity admin page so display stays consistent.
 *
 * Returns null for events that should be suppressed on the dashboard (e.g.
 * internal pipeline batch chatter). Callers decide whether to render null
 * as "(internal)" or skip the row.
 */

import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

type Meta = Record<string, unknown>;

const MAX_FIELDS_BEFORE_TRUNCATE = 3;

function humanizeDocType(slug: string): string {
  if (!slug) return "";
  return (
    DOCUMENT_TYPE_LABELS[slug] ||
    slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function summarizeFields(fields: unknown): string {
  if (!Array.isArray(fields) || fields.length === 0) return "";
  const names = fields
    .map((f) => String(f).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    .filter(Boolean);
  if (names.length <= MAX_FIELDS_BEFORE_TRUNCATE) return names.join(", ");
  const head = names.slice(0, MAX_FIELDS_BEFORE_TRUNCATE).join(", ");
  return `${head}, and ${names.length - MAX_FIELDS_BEFORE_TRUNCATE} more field${names.length - MAX_FIELDS_BEFORE_TRUNCATE !== 1 ? "s" : ""}`;
}

/**
 * Produce a human-readable one-liner for an audit log entry.
 * Returns null for events that should be hidden from user-facing feeds.
 */
export function activityTitle(
  action: string,
  resourceType: string,
  metadata: Meta | null | undefined,
): string | null {
  const a = action;
  const rt = resourceType;
  const meta = (metadata || {}) as Meta;

  // ── Suppressed events — internal pipeline chatter the user didn't trigger.
  if ((a === "create_batch" || a === "process_batch") && rt === "pipeline") return null;
  // Staging-field corrections in ProcessingView (entity reassignment, doc
  // type fixes, year edits). Useful for the audit log but uninteresting in
  // the user-facing Recent Activity feed.
  if (a === "edit" && rt === "pipeline_item") return null;

  // ── Entities
  if (a === "create" && rt === "entity") return `Created entity: ${str(meta.name) || str(meta.entity_name)}`;
  if (a === "edit" && rt === "entity") {
    const name = str(meta.entity_name) || str(meta.name);
    const fields = summarizeFields(meta.fields);
    if (name && fields) return `Updated ${name} (${fields})`;
    if (name) return `Updated ${name}`;
    return "Updated an entity";
  }
  if (a === "delete" && rt === "entity") return `Deleted entity${meta.entity_name ? `: ${str(meta.entity_name)}` : ""}`;
  if (a === "status_change" && rt === "entity") {
    const name = str(meta.entity_name) || str(meta.name);
    const to = str(meta.new_status) || str(meta.to);
    if (name && to) return `Changed ${name} status to ${to}`;
    if (to) return `Changed entity status to ${to}`;
    return "Changed an entity's status";
  }

  // ── Investments
  if (a === "create" && rt === "investment") return `Created investment: ${str(meta.name) || str(meta.investment_name)}`;
  if (a === "edit" && rt === "investment") return `Updated investment${meta.investment_name ? `: ${str(meta.investment_name)}` : ""}`;
  if (a === "delete" && rt === "investment") return `Deleted investment${meta.investment_name ? `: ${str(meta.investment_name)}` : ""}`;
  if (a === "create" && rt === "investment_transaction") {
    const txType = meta.transaction_type ? str(meta.transaction_type).replace(/_/g, " ") : "transaction";
    const amt = meta.amount ? `$${Number(meta.amount).toLocaleString()}` : "";
    return `Recorded ${txType}${amt ? ` of ${amt}` : ""}`;
  }
  if (a === "create" && rt === "investment_allocation") return `Updated allocations${meta.investment_name ? ` for ${str(meta.investment_name)}` : ""}`;
  if (a === "create" && rt === "investment_investor") return `Added investor${meta.investor_name ? `: ${str(meta.investor_name)}` : ""}`;
  if (a === "delete" && rt === "investment_investor") return `Removed investor${meta.investor_name ? `: ${str(meta.investor_name)}` : ""}`;
  if (a === "create" && rt === "investment_co_investor") return `Added co-investor${meta.name ? `: ${str(meta.name)}` : ""}`;

  // ── Documents — upload / link / unlink / archive / download / delete
  if (a === "upload" && rt === "document") return `Uploaded document: ${str(meta.document_name)}`;
  if (a === "upload" && rt === "pipeline") {
    const filenames = meta.filenames as string[] | undefined;
    const count = (meta.file_count as number) || filenames?.length || 0;
    if (filenames?.length) {
      return `Uploaded ${count} document${count !== 1 ? "s" : ""}: ${filenames.join(", ")}`;
    }
    return `Uploaded ${count} document${count !== 1 ? "s" : ""}`;
  }
  if (a === "delete" && rt === "document") return `Deleted document: ${str(meta.document_name)}`;
  if (a === "download" && rt === "document") return `Downloaded: ${str(meta.name) || str(meta.document_name)}`;
  if (a === "link" && rt === "document") {
    const doc = str(meta.document_name) || str(meta.name) || "a document";
    const entity = str(meta.entity_name) || str(meta.investment_name);
    return entity ? `Linked ${doc} to ${entity}` : `Linked ${doc}`;
  }
  if (a === "unlink" && rt === "document") {
    return `Unlinked ${str(meta.document_name) || str(meta.name) || "a document"}`;
  }
  if (a === "archive" && rt === "document") {
    return `Archived: ${str(meta.document_name) || str(meta.name) || "a document"}`;
  }

  // ── Pipeline / extraction events
  if (a === "dismiss_extraction" && rt === "document") {
    return `Dismissed ${str(meta.document_name) || "a document"} from review`;
  }
  if (a === "apply_extraction") {
    return `Applied AI extraction to ${str(meta.document_name) || "a document"}`;
  }
  if (a === "approve" && rt === "pipeline_item") {
    const doc = str(meta.document_name) || "a document";
    const entity = str(meta.entity_name);
    return entity ? `Approved: ${entity} — ${doc}` : `Approved: ${doc}`;
  }
  if (a === "reject" && rt === "pipeline_item") {
    const doc = str(meta.document_name) || "a document";
    const entity = str(meta.entity_name);
    return entity ? `Rejected: ${entity} — ${doc}` : `Rejected: ${doc}`;
  }
  if (a === "ingest" && rt === "pipeline_item") {
    return `Ingested: ${str(meta.document_name) || "a document"}`;
  }

  // ── Inference / patterns
  if ((a === "promote_pattern") || (a === "promote" && rt === "org_document_pattern")) {
    const docType = humanizeDocType(str(meta.document_type) || str(meta.pattern_name));
    return docType
      ? `Promoted "${docType}" to a document requirement`
      : "Promoted a detected pattern to a document requirement";
  }
  if ((a === "dismiss_pattern") || (a === "dismiss" && rt === "org_document_pattern")) {
    const docType = humanizeDocType(str(meta.document_type) || str(meta.pattern_name));
    return docType ? `Dismissed pattern: ${docType}` : "Dismissed a detected pattern";
  }

  // ── Document expectations
  if (a === "add" && rt === "document_expectation") {
    const docType = humanizeDocType(str(meta.document_type));
    return docType ? `Added document requirement: ${docType}` : "Added a document requirement";
  }
  if (a === "dismiss" && rt === "document_expectation") {
    const docType = humanizeDocType(str(meta.document_type));
    return docType ? `Dismissed document requirement: ${docType}` : "Dismissed a document requirement";
  }
  if (a === "confirm_suggestion" && rt === "document_expectation") {
    const docType = humanizeDocType(str(meta.document_type));
    return docType ? `Accepted suggestion: ${docType}` : "Accepted a document suggestion";
  }

  // ── State IDs
  if (a === "upsert_state_id" || (a === "upsert" && rt === "entity_state_id")) {
    const entity = str(meta.entity_name);
    const jurisdiction = str(meta.jurisdiction);
    return `Updated ${jurisdiction ? `${jurisdiction} ` : ""}state ID${entity ? ` for ${entity}` : ""}`;
  }

  // ── Compliance obligations
  if ((a === "update" || a === "update_obligation") && rt === "compliance_obligation") {
    const entity = str(meta.entity_name);
    const name = str(meta.obligation_name) || str(meta.name);
    if (name && entity) return `Updated ${name} for ${entity}`;
    if (name) return `Updated compliance: ${name}`;
    if (entity) return `Updated compliance deadline for ${entity}`;
    return "Updated a compliance deadline";
  }
  if (a === "create" && rt === "compliance_obligation") {
    const entity = str(meta.entity_name);
    const name = str(meta.name) || str(meta.obligation_name);
    if (name && entity) return `Added ${name} for ${entity}`;
    if (name) return `Added compliance: ${name}`;
    return `Added a compliance deadline${entity ? ` for ${entity}` : ""}`;
  }
  if (a === "complete" && rt === "compliance_obligation") {
    const name = str(meta.name) || str(meta.obligation_name) || "obligation";
    return `Marked ${name} as complete`;
  }

  // ── Relationships
  if (a === "create" && rt === "relationship") {
    const desc = str(meta.description) || str(meta.type);
    return desc ? `Created relationship: ${desc}` : "Created a relationship";
  }
  if (a === "delete" && rt === "relationship") return "Removed a relationship";

  // ── Members / managers / roles
  if (a === "create" && rt === "entity_member") {
    return `Added member${meta.name || meta.investor_name ? `: ${str(meta.name) || str(meta.investor_name)}` : ""}`;
  }
  if (a === "create" && rt === "entity_manager") {
    return `Added manager${meta.name ? `: ${str(meta.name)}` : ""}`;
  }
  if (a === "delete" && rt === "entity_manager") {
    return `Removed manager${meta.name ? `: ${str(meta.name)}` : ""}`;
  }
  if (a === "create" && rt === "trust_role") {
    const role = meta.title ? str(meta.title).replace(/_/g, " ") : "role";
    return `Added ${role}${meta.name ? `: ${str(meta.name)}` : ""}`;
  }

  // ── Directory
  if (a === "create" && rt === "directory_entry") return `Added to directory: ${str(meta.name)}`;
  if (a === "edit" && rt === "directory_entry") return `Updated directory entry: ${str(meta.name)}`;
  if (a === "delete" && rt === "directory_entry") return `Removed from directory: ${str(meta.name)}`;

  // ── Cap table
  if (a === "create" && rt === "cap_table_entry") return `Added cap table entry: ${str(meta.investor_name)}`;

  // ── Sensitive reveals
  if (a === "sensitive_reveal") {
    return `Viewed sensitive data for ${str(meta.entity_name) || str(meta.name) || "a record"}`;
  }

  // ── Users / invites (admin surface)
  if (a === "invite") {
    const email = str(meta.email);
    const role = str(meta.role) || str(meta.new_role);
    if (email && role) return `Invited ${email} as ${role}`;
    if (email) return `Invited ${email}`;
    return "Invited a user";
  }
  if (a === "role_change") {
    const email = str(meta.email) || str(meta.name);
    const role = str(meta.new_role) || str(meta.role);
    if (email && role) return `Changed ${email}'s role to ${role}`;
    if (role) return `Changed a user's role to ${role}`;
    return "Changed a user's role";
  }

  // ── Generic fallback — produce something readable for any unhandled combo.
  const actionLabel = a.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const resourceLabel = rt.replace(/_/g, " ");
  const name = str(meta.name) || str(meta.entity_name) || str(meta.document_name);
  return name ? `${actionLabel}: ${name}` : `${actionLabel} ${resourceLabel}`;
}
