/**
 * Shared role categorization for document_entity_links.role.
 *
 * The spec (§5 "Documents relating to two or more parties") distinguishes
 * between **first-class related roles** — which should surface a document
 * inline on the related entity's Documents tab — and **referenced-in roles**,
 * which surface only behind a "Referenced in" filter toggle.
 *
 * Keep this list in exactly one place. Both the server-side tab query
 * (`/api/entities/[id]/documents`) and the UI chips consume it.
 */

// Roles that represent genuine co-ownership or co-filing. Documents with
// these related roles surface inline on the related entity's Documents tab
// with a role chip (e.g. "Co-filer", "Member").
export const FIRST_CLASS_RELATED_ROLES = [
  "co_filer",
  "joint_filer",
  "co_owner",
  "co_beneficiary_primary",
  "member",
] as const;

// Roles that represent peripheral reference (e.g. an LLC named in somebody
// else's K-1 just because it's the issuer). Documents with only these
// related roles are hidden behind a "Referenced in" filter on the related
// entity's Documents tab.
export const REFERENCED_IN_ROLES = [
  "investment_issuer",
  "service_provider",
  "counterparty",
  "witness",
  "co_beneficiary_secondary",
] as const;

export type FirstClassRelatedRole = (typeof FIRST_CLASS_RELATED_ROLES)[number];
export type ReferencedInRole = (typeof REFERENCED_IN_ROLES)[number];

const FIRST_CLASS_SET: Set<string> = new Set(FIRST_CLASS_RELATED_ROLES);
const REFERENCED_SET: Set<string> = new Set(REFERENCED_IN_ROLES);

export function isFirstClassRelatedRole(role: string | null | undefined): boolean {
  return !!role && FIRST_CLASS_SET.has(role);
}

export function isReferencedInRole(role: string | null | undefined): boolean {
  return !!role && REFERENCED_SET.has(role);
}

// Display labels for role chips on the Documents tab. Keys are the raw role
// values stored in document_entity_links.role; values are human-readable.
export const ROLE_CHIP_LABELS: Record<string, string> = {
  co_filer: "Co-filer",
  joint_filer: "Joint filer",
  co_owner: "Co-owner",
  co_beneficiary_primary: "Co-beneficiary",
  co_beneficiary_secondary: "Co-beneficiary",
  member: "Member",
  investment_issuer: "Issuer",
  service_provider: "Service provider",
  counterparty: "Counterparty",
  witness: "Witness",
  primary: "Primary",
  related: "Related",
};
