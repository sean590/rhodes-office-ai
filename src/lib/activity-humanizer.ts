/**
 * activity-humanizer — turns raw audit_log rows into friendly, human copy for
 * Home → Done (and anywhere activity is shown). Never surfaces raw event names
 * like "upsert_state_id". Also resolves the actor: You (current user), a named
 * teammate, or Rhodes (automated / no user).
 */

import type { IconName } from "@/components/ui/icon";

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
  text: string;
  icon: IconName;
  color: string;
  created_at: string;
  entity_id?: string | null;
}

const VERB: Record<string, string> = {
  create: "Created",
  update: "Updated",
  archive: "Archived",
  delete: "Deleted",
  send: "Sent",
  revoke: "Revoked",
  link: "Linked",
  unlink: "Unlinked",
  download: "Downloaded",
  complete: "Completed",
  reject: "Rejected",
  approve: "Approved",
  dismiss: "Dismissed",
};

// resource_type → human noun.
const NOUN: Record<string, string> = {
  entity: "entity",
  investment: "investment",
  investment_transaction: "transaction",
  document: "document",
  directory_entry: "contact",
  service_provider: "provider",
  service_provider_entity: "provider link",
  provider_document_send: "document send",
  compliance_obligation: "filing",
  entity_registration: "registration",
  entity_state_id: "state ID",
  relationship: "relationship",
};

const ICON: Record<string, { icon: IconName; color: string }> = {
  entity: { icon: "building", color: "var(--green)" },
  investment: { icon: "chart-pie", color: "var(--purple)" },
  document: { icon: "file-text", color: "var(--blue)" },
  directory_entry: { icon: "user", color: "var(--teal)" },
  service_provider: { icon: "users", color: "var(--teal)" },
  provider_document_send: { icon: "send", color: "var(--green)" },
  compliance_obligation: { icon: "checklist", color: "var(--amber)" },
};

function nameFrom(m: Record<string, unknown>): string | null {
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

export function humanizeActivity(row: RawActivity, currentUserId?: string | null): HumanActivity {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const verb = VERB[row.action] ?? row.action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const noun = NOUN[row.resource_type] ?? row.resource_type.replace(/_/g, " ");
  const name = nameFrom(m);

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

  // Copy — a few special cases, else "<verb> <noun> <name>".
  let text: string;
  if (row.resource_type === "provider_document_send" && row.action === "send") {
    const to = typeof m.provider_name === "string" ? ` to ${m.provider_name}` : "";
    text = `Sent ${name ?? "a document"}${to}`;
  } else if (row.resource_type === "compliance_obligation" && row.action === "complete") {
    text = `Completed filing${name ? ` ${name}` : ""}${m.entity_name ? ` for ${m.entity_name}` : ""}`;
  } else if (name) {
    text = `${verb} ${noun} ${name}`;
  } else if (m.entity_name) {
    text = `${verb} ${noun} on ${m.entity_name}`;
  } else {
    text = `${verb} ${noun}`;
  }

  const visual = ICON[row.resource_type] ?? { icon: "circle-check" as IconName, color: "var(--muted)" };

  return {
    id: row.id,
    actor,
    actorName,
    text,
    icon: visual.icon,
    color: visual.color,
    created_at: row.created_at,
    entity_id: row.entity_id,
  };
}
