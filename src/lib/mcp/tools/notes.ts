/**
 * Notes-domain read tools — list_notes.
 * The chronological note history for a record ("what's been noted about X").
 */
import { z } from "zod";
import { defineTool, MAX_LIST_ROWS, type ToolDefinition } from "../schema";

const TARGET_COLUMN = {
  entity: "entity_id",
  investment: "investment_id",
  contact: "directory_entry_id",
  document: "document_id",
} as const;

export const listNotesTool = defineTool({
  name: "list_notes",
  description:
    "List the dated notes attached to a record (entity, investment, external contact, or document), newest first. Use to answer 'what's been noted about X' or 'what's going on with X'.",
  kind: "read",
  inputSchema: z.object({
    type: z.enum(["entity", "investment", "contact", "document"]),
    id: z.string().uuid(),
  }),
  handler: async (args, ctx) => {
    const column = TARGET_COLUMN[args.type];
    const { data: links } = await ctx.supabase
      .from("note_links")
      .select("note_id")
      .eq("organization_id", ctx.orgId)
      .eq(column, args.id);
    const ids = Array.from(new Set((links ?? []).map((l) => l.note_id as string)));
    if (ids.length === 0) return { data: { notes: [] } };
    const { data: notes } = await ctx.supabase
      .from("notes")
      .select("id, body, note_date, created_at")
      .in("id", ids)
      .order("note_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(MAX_LIST_ROWS);
    return { data: { notes: notes ?? [] } };
  },
});

export const notesReadTools: ToolDefinition[] = [listNotesTool];
