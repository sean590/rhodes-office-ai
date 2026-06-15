/**
 * activity-humanizer — THE single source of truth for turning raw audit_log
 * rows into friendly, human copy. Every activity surface (Home → Done, the
 * entity Activity tab, Settings → Activity) renders through this module so the
 * same event reads identically no matter where it appears.
 *
 * It never surfaces raw event names ("upsert_state_id") or raw schema codes
 * ("tax_classification"), resolves the actor (You / a named teammate / Rhodes),
 * and supplies a per-resource icon + color and a "View" target.
 *
 * Output shape:
 *   - lead   — the action phrase, rendered in ink ("Updated RCM Mainstream LLC")
 *   - detail — muted context ("Tax classification", "DE · 9d overdue")
 *   - text   — flat single-line join of lead + detail (for table/list surfaces)
 *   - suppressed — internal pipeline chatter the user didn't trigger; hide it
 *   - actor / actorName / icon / color / viewHref — presentation metadata
 *
 * When adding a new audited action, add ONE case here — not in a surface.
 */

import type { IconName } from "@/components/ui/icon";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";

export interface RawActivity {
  id: string;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  entity_id?: string | null;
  investment_id?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export type ActorKind = "you" | "person" | "rhodes";

export interface HumanActivity {
  id: string;
  actor: ActorKind;
  actorName: string;
  /** Action phrase, rendered in ink (e.g. "Marked CA Statement of Information filed"). */
  lead: string;
  /** Context — entity / provider / field — rendered muted (e.g. "Tax classification"). */
  detail: string | null;
  /** Flat single-line fallback (lead + detail) for non-two-tone surfaces. */
  text: string;
  /** Internal pipeline chatter the user didn't trigger — surfaces should hide it. */
  suppressed: boolean;
  icon: IconName;
  color: string;
  created_at: string;
  /** Where "View" navigates, if resolvable. */
  viewHref: string | null;
  entity_id?: string | null;
}

const MAX_FIELDS_BEFORE_TRUNCATE = 3;

type Meta = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

/** Title-case a snake_case slug ("annual_report" → "Annual Report"). */
function titleCase(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Sentence-case a snake_case field name ("tax_classification" → "Tax classification"). */
function sentenceCase(slug: string): string {
  return slug.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function humanizeDocType(slug: string): string {
  if (!slug) return "";
  return DOCUMENT_TYPE_LABELS[slug] || titleCase(slug);
}

/** Readable, truncated list of changed field names for entity/trust edits. */
function summarizeFields(fields: unknown): string {
  if (!Array.isArray(fields) || fields.length === 0) return "";
  const names = fields.map((f) => sentenceCase(String(f))).filter(Boolean);
  if (names.length <= MAX_FIELDS_BEFORE_TRUNCATE) return names.join(", ");
  const head = names.slice(0, MAX_FIELDS_BEFORE_TRUNCATE).join(", ");
  const extra = names.length - MAX_FIELDS_BEFORE_TRUNCATE;
  return `${head}, and ${extra} more field${extra !== 1 ? "s" : ""}`;
}

function nameFrom(m: Meta): string | null {
  for (const k of ["document_name", "name", "provider_name", "entity_name", "investment_name", "title", "label"]) {
    const v = m[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const docNames = m.document_names;
  if (Array.isArray(docNames) && docNames.length) {
    return docNames.length === 1 ? String(docNames[0]) : `${docNames.length} documents`;
  }
  return null;
}

interface Described {
  lead: string;
  detail: string | null;
  suppressed?: boolean;
}

/**
 * Map (action, resource_type, metadata) → { lead, detail }. The union of every
 * case the app's three former humanizers handled. Add new audited actions here.
 */
function describe(action: string, rt: string, m: Meta): Described {
  const a = action;

  // ── Suppressed — internal pipeline chatter the user didn't trigger ────
  if ((a === "create_batch" || a === "process_batch") && rt === "pipeline") {
    return { lead: "Processed documents", detail: null, suppressed: true };
  }
  // Staging-field corrections in ProcessingView (entity reassignment, doc-type
  // fixes). Useful for the raw audit, uninteresting in user-facing feeds.
  if (a === "edit" && rt === "pipeline_item") {
    return { lead: "Adjusted a document in review", detail: null, suppressed: true };
  }

  // ── Entities ──────────────────────────────────────────────────────────
  if (a === "create" && rt === "entity") {
    const name = str(m.name) || str(m.entity_name);
    return { lead: name ? `Created ${name}` : "Created an entity", detail: m.type ? titleCase(str(m.type)) : null };
  }
  if (a === "edit" && rt === "entity") {
    const name = str(m.entity_name) || str(m.name);
    return { lead: name ? `Updated ${name}` : "Updated an entity", detail: summarizeFields(m.fields) || null };
  }
  if (a === "delete" && rt === "entity") {
    const name = str(m.entity_name) || str(m.name);
    return { lead: name ? `Deleted ${name}` : "Deleted an entity", detail: null };
  }
  if (a === "status_change" && rt === "entity") {
    const name = str(m.entity_name) || str(m.name);
    const to = str(m.new_status) || str(m.to);
    return { lead: name ? `Changed ${name} status` : "Changed an entity's status", detail: to ? titleCase(to) : null };
  }

  // ── Entity roles / members / managers / partnership rep / trust roles ──
  if (rt === "entity_role") {
    const role = str(m.role_title) || "role";
    return { lead: `${a === "delete" ? "Removed" : "Added"} role: ${role}`, detail: str(m.name) || null };
  }
  if (rt === "entity_member") {
    return { lead: a === "delete" ? "Removed member" : "Added member", detail: str(m.name) || str(m.investor_name) || null };
  }
  if (rt === "entity_manager") {
    return { lead: a === "delete" ? "Removed manager" : "Added manager", detail: str(m.name) || null };
  }
  if (rt === "partnership_rep") {
    return { lead: a === "delete" ? "Removed partnership representative" : "Added partnership representative", detail: str(m.name) || null };
  }
  if (rt === "trust_role") {
    const role = m.title ? titleCase(str(m.title)) : m.role ? titleCase(str(m.role)) : "role";
    return { lead: `${a === "delete" ? "Removed" : "Added"} ${role}`, detail: str(m.name) || null };
  }
  if (a === "edit" && rt === "trust_details") {
    return { lead: "Updated trust details", detail: summarizeFields(m.fields_updated) || null };
  }

  // ── Entity registrations / state IDs ──────────────────────────────────
  if (rt === "entity_registration") {
    const verb = a === "delete" ? "Removed" : a === "edit" ? "Updated" : "Added";
    return { lead: `${verb} registration`, detail: str(m.jurisdiction) || null };
  }
  if (a === "upsert_state_id" || (a === "upsert" && rt === "entity_state_id")) {
    const jur = str(m.jurisdiction);
    const entity = str(m.entity_name);
    return {
      lead: `Updated ${jur ? `${jur} ` : ""}state ID`,
      detail: entity || null,
    };
  }

  // ── Custom fields ─────────────────────────────────────────────────────
  if (rt === "custom_field") {
    const verb = a === "delete" ? "Removed" : a === "edit" ? "Updated" : "Added";
    return { lead: `${verb} custom field`, detail: str(m.field_name) || null };
  }

  // ── Cap table ─────────────────────────────────────────────────────────
  if (rt === "cap_table_entry") {
    return { lead: a === "delete" ? "Removed cap table entry" : "Added cap table entry", detail: str(m.investor_name) || null };
  }

  // ── Investments ───────────────────────────────────────────────────────
  if (a === "create" && rt === "investment") {
    return { lead: "Created investment", detail: str(m.name) || str(m.investment_name) || null };
  }
  if (a === "edit" && rt === "investment") {
    return { lead: "Updated investment", detail: str(m.investment_name) || str(m.name) || null };
  }
  if (a === "delete" && rt === "investment") {
    return { lead: "Deleted investment", detail: str(m.investment_name) || str(m.name) || null };
  }
  if (rt === "investment_transaction") {
    if (a === "delete") return { lead: "Deleted transaction", detail: null };
    const txType = m.transaction_type ? str(m.transaction_type).replace(/_/g, " ") : "transaction";
    const amt = m.amount ? `$${Number(m.amount).toLocaleString()}` : "";
    return { lead: `Recorded ${txType}${amt ? ` of ${amt}` : ""}`, detail: null };
  }
  if (rt === "investment_allocation") {
    if (a === "delete") return { lead: "Deactivated investment allocation", detail: null };
    const name = str(m.investment_name);
    return { lead: name ? `Updated allocations for ${name}` : "Updated investment allocations", detail: null };
  }
  if (rt === "investment_investor") {
    return { lead: a === "delete" ? "Removed investor" : "Added investor", detail: str(m.investor_name) || null };
  }
  if (a === "create" && rt === "investment_co_investor") {
    return { lead: "Added co-investor", detail: str(m.name) || null };
  }

  // ── Documents ─────────────────────────────────────────────────────────
  if (a === "upload" && rt === "document") {
    return { lead: "Uploaded document", detail: str(m.document_name) || null };
  }
  if (a === "upload" && rt === "pipeline") {
    const filenames = m.filenames as string[] | undefined;
    const count = (m.file_count as number) || filenames?.length || 0;
    return {
      lead: `Uploaded ${count} document${count !== 1 ? "s" : ""}`,
      detail: filenames?.length ? filenames.join(", ") : null,
    };
  }
  if (a === "delete" && rt === "document") {
    return { lead: "Deleted document", detail: str(m.document_name) || null };
  }
  if (a === "download" && rt === "document") {
    return { lead: "Downloaded document", detail: str(m.name) || str(m.document_name) || null };
  }
  if (a === "link" && rt === "document") {
    const doc = str(m.document_name) || str(m.name) || "a document";
    const entity = str(m.entity_name) || str(m.investment_name);
    return { lead: entity ? `Linked ${doc} to ${entity}` : `Linked ${doc}`, detail: null };
  }
  if (a === "unlink" && rt === "document") {
    return { lead: "Unlinked document", detail: str(m.document_name) || str(m.name) || null };
  }
  if (a === "edit" && rt === "document") {
    return { lead: "Edited document", detail: str(m.document_name) || str(m.name) || summarizeFields(m.fields) || null };
  }
  if (a === "archive" && rt === "document") {
    return { lead: "Archived document", detail: str(m.document_name) || str(m.name) || null };
  }

  // ── Pipeline / extraction ─────────────────────────────────────────────
  if (a === "dismiss_extraction") {
    return { lead: "Dismissed AI suggestions", detail: str(m.document_name) || null };
  }
  if (a === "apply_extraction") {
    const applied = (m.applied as number) || 0;
    const failed = (m.failed as number) || 0;
    return {
      lead: "Applied AI extraction",
      detail: str(m.document_name) || (applied ? `${applied} change${applied !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""}` : null),
    };
  }
  if (a === "process") {
    return { lead: "Processed document with AI", detail: m.action_count ? `${m.action_count} changes proposed` : null };
  }
  if (a === "approve" && rt === "pipeline_item") {
    const doc = str(m.document_name);
    const entity = str(m.entity_name);
    return { lead: doc ? `Ingested ${doc}` : "Approved document", detail: entity || null };
  }
  if (a === "reject" && rt === "pipeline_item") {
    const doc = str(m.document_name) || "a document";
    return { lead: `Rejected ${doc}`, detail: str(m.entity_name) || null };
  }
  if (a === "ingest" && rt === "pipeline_item") {
    return { lead: `Ingested ${str(m.document_name) || "document"}`, detail: m.document_type ? str(m.document_type).replace(/_/g, " ") : null };
  }
  if (a === "reprocess" && rt === "pipeline_item") {
    return { lead: "Retried a stuck document", detail: str(m.document_name) || null };
  }

  // ── Patterns / document expectations ──────────────────────────────────
  if (a === "promote_pattern" || (a === "promote" && rt === "org_document_pattern")) {
    const docType = humanizeDocType(str(m.document_type) || str(m.pattern_name));
    return { lead: docType ? `Promoted "${docType}" to a document requirement` : "Promoted a detected pattern to a document requirement", detail: null };
  }
  if (a === "dismiss_pattern" || (a === "dismiss" && rt === "org_document_pattern")) {
    const docType = humanizeDocType(str(m.document_type) || str(m.pattern_name));
    return { lead: docType ? `Dismissed pattern: ${docType}` : "Dismissed a detected pattern", detail: null };
  }
  if (rt === "document_expectation") {
    const docType = humanizeDocType(str(m.document_type));
    let lead: string;
    if (a === "add") lead = "Added required document";
    else if (a === "confirm_suggestion") lead = "Accepted document suggestion";
    else if (a === "dismiss") lead = "Dismissed required document";
    else lead = "Refreshed required documents";
    return { lead, detail: docType || null };
  }

  // ── Compliance obligations ────────────────────────────────────────────
  if ((a === "update" || a === "update_obligation" || a === "edit") && rt === "compliance_obligation") {
    const entity = str(m.entity_name);
    const name = str(m.obligation_name) || str(m.name);
    if (name) return { lead: `Updated ${name}`, detail: entity || (m.status ? `Status: ${titleCase(str(m.status))}` : null) };
    return { lead: entity ? `Updated compliance deadline for ${entity}` : "Updated a compliance deadline", detail: null };
  }
  if (a === "create" && rt === "compliance_obligation") {
    const entity = str(m.entity_name);
    const name = str(m.name) || str(m.obligation_name);
    return { lead: name ? `Added ${name}` : "Added a compliance deadline", detail: entity || null };
  }
  if (a === "complete" && rt === "compliance_obligation") {
    const name = str(m.name) || str(m.obligation_name) || "obligation";
    return { lead: `Marked ${name} as complete`, detail: str(m.entity_name) || null };
  }

  // ── Relationships ─────────────────────────────────────────────────────
  if (a === "create" && rt === "relationship") {
    const desc = str(m.description) || str(m.type);
    return { lead: "Created relationship", detail: desc ? titleCase(desc) : null };
  }
  if (a === "delete" && rt === "relationship") {
    return { lead: "Removed a relationship", detail: null };
  }

  // ── Directory / people ────────────────────────────────────────────────
  if (rt === "directory_entry") {
    const verb = a === "delete" ? "Removed from directory" : a === "edit" ? "Updated directory entry" : "Added to directory";
    return { lead: verb, detail: str(m.name) || null };
  }

  // ── Provider document sends ───────────────────────────────────────────
  if (rt === "provider_document_send" && a === "send") {
    const doc = nameFrom(m) ?? "a document";
    const provider = str(m.provider_name);
    const entity = str(m.entity_name);
    return { lead: `Sent ${doc}`, detail: [provider, entity].filter(Boolean).join(" · ") || null };
  }

  // ── Sensitive reveals ─────────────────────────────────────────────────
  if (a === "sensitive_reveal") {
    return { lead: "Viewed sensitive data", detail: str(m.entity_name) || str(m.name) || null };
  }

  // ── Users / invites (admin surface) ───────────────────────────────────
  if (a === "invite") {
    const email = str(m.email);
    const role = str(m.role) || str(m.new_role);
    return { lead: email ? `Invited ${email}` : "Invited a user", detail: role ? `as ${role}` : null };
  }
  if (a === "role_change") {
    const email = str(m.email) || str(m.name);
    const role = str(m.new_role) || str(m.role);
    return { lead: email ? `Changed ${email}'s role` : "Changed a user's role", detail: role ? `to ${role}` : null };
  }

  // ── Generic fallback — readable for any unhandled combo ────────────────
  const name = nameFrom(m);
  const lead = `${sentenceCase(a)} ${rt.replace(/_/g, " ")}`.trim();
  return { lead, detail: name };
}

const ICON: Record<string, { icon: IconName; color: string }> = {
  entity: { icon: "building", color: "var(--green)" },
  entity_registration: { icon: "building", color: "var(--green)" },
  entity_state_id: { icon: "building", color: "var(--green)" },
  entity_member: { icon: "user", color: "var(--teal)" },
  entity_manager: { icon: "user", color: "var(--teal)" },
  entity_role: { icon: "user", color: "var(--teal)" },
  trust_role: { icon: "user", color: "var(--teal)" },
  partnership_rep: { icon: "user", color: "var(--teal)" },
  investment: { icon: "chart-pie", color: "var(--purple)" },
  investment_transaction: { icon: "chart-pie", color: "var(--green)" },
  investment_allocation: { icon: "chart-pie", color: "var(--blue)" },
  investment_investor: { icon: "chart-pie", color: "var(--purple)" },
  investment_co_investor: { icon: "chart-pie", color: "var(--amber)" },
  cap_table_entry: { icon: "chart-pie", color: "var(--blue)" },
  document: { icon: "file-text", color: "var(--blue)" },
  pipeline: { icon: "file-text", color: "var(--blue)" },
  pipeline_item: { icon: "file-text", color: "var(--blue)" },
  document_expectation: { icon: "file-text", color: "var(--blue)" },
  org_document_pattern: { icon: "file-text", color: "var(--blue)" },
  directory_entry: { icon: "user", color: "var(--teal)" },
  service_provider: { icon: "users", color: "var(--teal)" },
  provider_document_send: { icon: "send", color: "var(--green)" },
  compliance_obligation: { icon: "checklist", color: "var(--amber)" },
  relationship: { icon: "affiliate", color: "var(--purple)" },
};

export function humanizeActivity(row: RawActivity, currentUserId?: string | null): HumanActivity {
  const m = (row.metadata ?? {}) as Meta;
  const { lead, detail, suppressed } = describe(row.action, row.resource_type, m);

  // Actor.
  let actor: ActorKind = "rhodes";
  let actorName = "Rhodes";
  if (row.user_id) {
    if (currentUserId && row.user_id === currentUserId) {
      actor = "you";
      actorName = "You";
    } else {
      actor = "person";
      actorName = row.user_name || "A teammate";
    }
  }

  const visual = ICON[row.resource_type] ?? { icon: "circle-check" as IconName, color: "var(--muted)" };
  const viewHref = row.entity_id
    ? `/entities/${row.entity_id}`
    : row.investment_id
      ? `/investments/${row.investment_id}`
      : null;

  return {
    id: row.id,
    actor,
    actorName,
    lead,
    detail: detail || null,
    text: detail ? `${lead} — ${detail}` : lead,
    suppressed: Boolean(suppressed),
    icon: visual.icon,
    color: visual.color,
    created_at: row.created_at,
    viewHref,
    entity_id: row.entity_id,
  };
}

/**
 * Convenience single-line label for table/list surfaces. Returns null for
 * suppressed internal events so callers can skip or render "(internal event)".
 */
export function activityText(row: RawActivity, currentUserId?: string | null): string | null {
  const h = humanizeActivity(row, currentUserId);
  return h.suppressed ? null : h.text;
}
