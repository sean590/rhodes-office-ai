import { createAdminClient } from "./admin";

/**
 * Org-scoped admin client — a "supervised master key".
 *
 * WHY THIS EXISTS
 * ---------------
 * `createAdminClient()` uses the service-role key, which BYPASSES Row Level
 * Security. RLS (migration 068) protects the normal logged-in path (anon key +
 * the user's JWT) — Postgres checks every row against the caller's org. But the
 * service-role key skips that check entirely. So every one of the ~336
 * server-side `createAdminClient()` call sites is responsible for *manually*
 * adding `.eq("organization_id", orgId)` to each query. Forget it once and you
 * have a cross-tenant leak that RLS can't catch, because the master key already
 * walked past the lock.
 *
 * `createOrgClient(orgId)` removes that footgun for org-owned tables: it stamps
 * `organization_id = orgId` onto every read (`.eq`) and every write (injected
 * into the row), automatically. You physically cannot forget the filter,
 * because the wrapper adds it for you. For the cases the wrapper can't scope
 * (child tables without an org_id column, `auth`, `storage`, cross-org system
 * jobs), use `.raw` — an explicit, greppable, lint-flaggable escape hatch.
 *
 * USAGE
 *   const db = createOrgClient(orgId);
 *   const { data } = await db.from("documents").select("*").eq("id", id);   // org filter auto-added
 *   await db.from("documents").insert({ name, file_path });                 // organization_id auto-set
 *   const { data } = await db.raw.from("entity_members").select("*");       // escape hatch (child table)
 *
 * The returned `from(...)` builder forwards every other PostgREST method
 * (`.eq`, `.order`, `.single`, `.or`, `.in`, `.range`, `.maybeSingle`, …) to the
 * underlying query, so existing chains keep working unchanged.
 */

/**
 * Tables that carry `organization_id` directly (source of truth: live DB,
 * `information_schema.columns WHERE column_name='organization_id'`, 2026-06-27).
 * Only these can be auto-scoped. Anything else must go through `.raw`.
 *
 * Deliberately EXCLUDED even though they have organization_id:
 *  - `audit_log`        — RLS makes it read-only/append; writes go via `.raw`
 *                         (and inserts must set organization_id explicitly).
 *  - `organization_members` / `organization_invites` — membership management is
 *    a privileged cross-cutting op; route it through `.raw` so it's reviewed.
 *  - `document_types`   — has BOTH org-scoped and global (organization_id NULL)
 *                         rows; auto-eq would hide the globals. Use `.raw`.
 */
const ORG_TABLES = new Set<string>([
  "chat_feedback",
  "chat_sessions",
  "chat_tool_calls",
  "compliance_obligations",
  "compliance_profiles",
  "custom_field_definitions",
  "directory_entries",
  "document_batches",
  "document_entity_links",
  "document_expectation_templates",
  "document_profiles",
  "document_queue",
  "documents",
  "entities",
  "entity_document_expectations",
  "investment_allocations",
  "investment_co_investors",
  "investment_investors",
  "investment_transactions",
  "investments",
  "org_compliance_overrides",
  "org_document_overrides",
  "org_document_patterns",
  "org_provider_routing_rules",
  "provider_document_send_access",
  "provider_document_send_documents",
  "provider_document_sends",
  "provider_send_dismissals",
  "relationships",
  "service_provider_entities",
  "service_providers",
]);

export type OrgTable =
  | "chat_feedback"
  | "chat_sessions"
  | "chat_tool_calls"
  | "compliance_obligations"
  | "compliance_profiles"
  | "custom_field_definitions"
  | "directory_entries"
  | "document_batches"
  | "document_entity_links"
  | "document_expectation_templates"
  | "document_profiles"
  | "document_queue"
  | "documents"
  | "entities"
  | "entity_document_expectations"
  | "investment_allocations"
  | "investment_co_investors"
  | "investment_investors"
  | "investment_transactions"
  | "investments"
  | "org_compliance_overrides"
  | "org_document_overrides"
  | "org_document_patterns"
  | "org_provider_routing_rules"
  | "provider_document_send_access"
  | "provider_document_send_documents"
  | "provider_document_sends"
  | "provider_send_dismissals"
  | "relationships"
  | "service_provider_entities"
  | "service_providers";

type Row = Record<string, unknown>;

function withOrg(rows: Row | Row[], orgId: string): Row | Row[] {
  // orgId is spread LAST so it always wins — a caller-supplied organization_id
  // (accidental or malicious) can never redirect a write into another org.
  if (Array.isArray(rows)) {
    return rows.map((r) => ({ ...r, organization_id: orgId }));
  }
  return { ...rows, organization_id: orgId };
}

/**
 * Build an org-scoped query builder for one org-owned table.
 *
 * - `select` / `update` / `delete` get `.eq("organization_id", orgId)` appended
 *   so they can never read or touch another org's rows.
 * - `insert` / `upsert` get `organization_id: orgId` injected into each row (a
 *   caller-supplied value is overridden — you cannot write into another org).
 *
 * The returned builder is the raw PostgREST builder with the org filter already
 * applied, so all the usual chained methods (`.eq`, `.order`, `.single`, `.or`,
 * `.in`, `.range`, …) work exactly as before.
 */
/**
 * Permissive PostgREST builder shape used by the wrapper.
 *
 * We DELIBERATELY do NOT re-thread supabase-js's own generic builder types
 * through this wrapper. supabase-js's `.select()` return type is a recursive
 * conditional type that parses the column string; invoked through a generic
 * wrapper it expands against an *abstract* type parameter at every call site,
 * which exhausted the TypeScript checker's memory and OOM'd the full-project
 * typecheck / `next build`. The admin client is untyped (no generated Database
 * type), so callers already receive `any`-typed data — casting the builder to
 * this shape preserves that exact ergonomics while keeping type-checking cheap.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chain = Promise<{ data: any; error: any; count: number | null }> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [method: string]: any;
};
interface OrgTableBuilder {
  select: (columns?: string, options?: unknown) => Chain;
  insert: (rows: Row | Row[]) => Chain;
  upsert: (rows: Row | Row[], options?: unknown) => Chain;
  update: (values: Row) => Chain;
  delete: () => Chain;
}

function scopedFrom(
  admin: ReturnType<typeof createAdminClient>,
  table: OrgTable,
  orgId: string
) {
  if (!ORG_TABLES.has(table)) {
    throw new Error(
      `createOrgClient: "${table}" is not an org-scoped table. Use \`.raw\` and ` +
        `apply tenant scoping explicitly (child table, global, or privileged op).`
    );
  }
  // Fresh builder per call (PostgREST builders are stateful), cast to the
  // permissive shape above to avoid supabase-js's heavy column-parsing generics.
  const tb = () => admin.from(table) as unknown as OrgTableBuilder;
  return {
    select: (
      columns?: string,
      options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }
    ) => tb().select(columns ?? "*", options).eq("organization_id", orgId),
    insert: (rows: Row | Row[]) => tb().insert(withOrg(rows, orgId)),
    upsert: (rows: Row | Row[], options?: Record<string, unknown>) =>
      tb().upsert(withOrg(rows, orgId), options),
    update: (values: Row) => tb().update(values).eq("organization_id", orgId),
    delete: () => tb().delete().eq("organization_id", orgId),
  };
}

export type OrgClient = {
  from: (table: OrgTable) => ReturnType<typeof scopedFrom>;
  /** Underlying service-role client — bypasses ALL scoping. Escape hatch only. */
  raw: ReturnType<typeof createAdminClient>;
  orgId: string;
};

/**
 * Create an org-scoped service-role client.
 *
 * `orgId` is normally the value from `requireOrg()` for the current request.
 * Pass it once here and every `.from(orgTable)` call is automatically confined
 * to that org.
 */
export function createOrgClient(orgId: string): OrgClient {
  if (!orgId) {
    throw new Error("createOrgClient: orgId is required");
  }
  const admin = createAdminClient();
  return {
    from: (table: OrgTable) => scopedFrom(admin, table, orgId),
    raw: admin,
    orgId,
  };
}
