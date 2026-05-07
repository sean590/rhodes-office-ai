/**
 * Directory-domain MCP tools.
 *
 * Both tools filter `deleted_at IS NULL` — archived entries must not appear
 * in tool results (Phase 0 migration 039 added the column and the read sites
 * were audited in the same session).
 *
 * `get_directory_entry` additionally returns back-references so Claude can
 * answer "who is this person related to?" without further tool calls. The
 * shape mirrors the GET `/api/directory/[id]` endpoint where practical.
 */

import { z } from "zod";
import { defineTool, MAX_LIST_ROWS, type ToolDefinition } from "../schema";
import { logSensitiveReveal } from "../tool-call-log";

// --- list_directory_entries --------------------------------------------------

const listDirectoryInput = z.object({
  name_query: z.string().optional().describe("Case-insensitive ILIKE match on name."),
  type: z.enum(["individual", "external_entity", "trust"]).optional(),
  limit: z.number().int().min(1).max(MAX_LIST_ROWS).optional().default(25),
});

export const listDirectoryEntriesTool = defineTool({
  name: "list_directory_entries",
  description:
    "List directory entries (people and external parties) in the user's organization. Excludes archived entries. Supports name search and type filter.",
  kind: "read",
  inputSchema: listDirectoryInput,
  handler: async (args, ctx) => {
    const limit = args.limit ?? 25;
    let query = ctx.supabase
      .from("directory_entries")
      .select("id, name, type, email, aliases")
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .order("name")
      .limit(limit + 1);

    if (args.name_query) query = query.ilike("name", `%${args.name_query}%`);
    if (args.type) query = query.eq("type", args.type);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown[];
    const truncated = rows.length > limit;
    return {
      data: ctx.redact(truncated ? rows.slice(0, limit) : rows),
      truncated,
    };
  },
});

// --- get_directory_entry -----------------------------------------------------

const DIRECTORY_REVEAL_FIELDS = [
  "ein", "tax_id", "ssn", "bank_account_number", "routing_number",
  "date_of_birth", "home_address", "driver_license_number", "passport_number",
];

const getDirectoryEntryInput = z.object({
  directory_entry_id: z.string().uuid(),
  reveal_sensitive: z.boolean().optional().default(false).describe(
    "If true, return unredacted sensitive fields (EIN, SSN, bank account, etc.) on this directory entry. Every reveal is audited.",
  ),
});

export const getDirectoryEntryTool = defineTool({
  name: "get_directory_entry",
  description:
    "Fetch one directory entry plus counts of the records that reference it (entity_members, entity_managers, cap_table_entries, investment_co_investors, investment_allocations, relationships). Useful for 'who is X related to' questions. Accepts reveal_sensitive to unredact all sensitive fields.",
  kind: "read",
  inputSchema: getDirectoryEntryInput,
  handler: async ({ directory_entry_id, reveal_sensitive }, ctx) => {
    // Enforce org scope on the entry itself — directory_entries carry
    // organization_id, so the filter here is the hard gate.
    const { data: entry, error } = await ctx.supabase
      .from("directory_entries")
      .select("*")
      .eq("id", directory_entry_id)
      .eq("organization_id", ctx.orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!entry) return { data: null };

    // Belt-and-suspenders org filter on child tables that carry
    // organization_id: investment_co_investors, investment_allocations,
    // relationships. Parent-gate-only tables (entity_members, entity_managers,
    // cap_table_entries) rely on the directory entry's own org filter above
    // — their rows are scoped transitively via the directory FK, and they
    // carry no organization_id column of their own.
    const [members, managers, caps, coInv, allocs, relFrom, relTo] = await Promise.all([
      ctx.supabase.from("entity_members").select("id", { count: "exact", head: true }).eq("directory_entry_id", directory_entry_id),
      ctx.supabase.from("entity_managers").select("id", { count: "exact", head: true }).eq("directory_entry_id", directory_entry_id),
      ctx.supabase.from("cap_table_entries").select("id", { count: "exact", head: true }).eq("investor_directory_id", directory_entry_id),
      ctx.supabase.from("investment_co_investors").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId).eq("directory_entry_id", directory_entry_id),
      ctx.supabase.from("investment_allocations").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId).eq("member_directory_id", directory_entry_id).eq("is_active", true),
      ctx.supabase.from("relationships").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId).eq("from_directory_id", directory_entry_id),
      ctx.supabase.from("relationships").select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId).eq("to_directory_id", directory_entry_id),
    ]);

    const revealFields = reveal_sensitive ? DIRECTORY_REVEAL_FIELDS : [];
    if (reveal_sensitive) {
      await logSensitiveReveal(ctx, {
        tool_name: "get_directory_entry",
        resource_type: "directory_entry",
        resource_id: directory_entry_id,
        fields_revealed: revealFields,
      });
    }

    return {
      data: ctx.redact(
        {
          ...entry,
          references: {
            entity_members: members.count ?? 0,
            entity_managers: managers.count ?? 0,
            cap_table_entries: caps.count ?? 0,
            investment_co_investors: coInv.count ?? 0,
            investment_allocations: allocs.count ?? 0,
            relationships: (relFrom.count ?? 0) + (relTo.count ?? 0),
          },
        },
        { reveal: revealFields },
      ),
    };
  },
});

export const directoryTools: ToolDefinition[] = [
  listDirectoryEntriesTool,
  getDirectoryEntryTool,
];
