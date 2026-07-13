import { OrgRole } from "@/lib/types/enums";

/**
 * Role-based access policy — the ONE place the permission matrix lives.
 *
 * PURE + client-safe: no server imports (no next/server, no supabase). Both the
 * server guards (`@/lib/utils/authz`) and client UI gating import from here, so
 * the matrix can never drift between "what the server enforces" and "what the UI
 * shows".
 *
 * Model: per-role CAPABILITY SETS (not a rank ladder), so roles are cheap config.
 * Adding a role later = one enum value + one entry here + expose in the UI.
 *
 * Roles in use (3): member < admin < owner. `viewer` remains in the org_role enum
 * as the non-member fallback and is granted NOTHING — a real org member is always
 * member/admin/owner, and non-members are already 403'd by requireOrg().
 */

export type Capability =
  // Data
  | "records:read" // view org data
  | "records:write" // create / edit / upload
  | "records:delete" // delete a top-level / financial record
  // Outbound
  | "providers:send" // send documents out to a service provider
  // Org / team management
  | "members:manage" // invite, remove, change roles (below owner)
  | "members:promote_admin" // promote someone to admin (owner-only)
  | "org:settings" // edit org settings
  | "org:delete" // delete the organization
  | "billing:manage"; // manage billing

/**
 * Capability grants per role. MUST be total over OrgRole. Higher roles are a
 * superset of lower ones today, but the set model means that's a convention, not
 * a constraint — a future non-linear role (e.g. "can send but not delete") just
 * gets its own set.
 */
export const ROLE_CAPABILITIES: Record<OrgRole, ReadonlySet<Capability>> = {
  // Unused fallback for non-members — deliberately empty.
  viewer: new Set<Capability>(),
  member: new Set<Capability>(["records:read", "records:write"]),
  admin: new Set<Capability>([
    "records:read",
    "records:write",
    "records:delete",
    "providers:send",
    "members:manage",
    "org:settings",
  ]),
  owner: new Set<Capability>([
    "records:read",
    "records:write",
    "records:delete",
    "providers:send",
    "members:manage",
    "members:promote_admin",
    "org:settings",
    "org:delete",
    "billing:manage",
  ]),
};

/** True if `role` is granted `cap`. */
export function can(role: OrgRole, cap: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.has(cap) ?? false;
}

/**
 * The sensitive actions that (Increment 3) will additionally require a fresh
 * MFA step-up (AAL2) for, beyond the role check. Defined here so the role layer
 * and the MFA layer key off ONE list.
 */
export const SENSITIVE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "records:delete",
  "providers:send",
  "members:manage",
  "members:promote_admin",
  "org:settings",
  "org:delete",
  "billing:manage",
]);

/** Display ordering only (higher = more privileged). Not used for permission checks. */
export const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/** Roles assignable through the UI (excludes the unused `viewer` fallback). */
export const ASSIGNABLE_ROLES: readonly OrgRole[] = ["member", "admin", "owner"];
