/**
 * Notes-domain write tools — create_note.
 * Lets chat memorialize a call/meeting/decision and attach it to records.
 */
import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { dispatchAction } from "../apply-dispatch";

const noteLink = z.object({
  type: z.enum(["entity", "investment", "contact", "document"]),
  id: z.string().uuid(),
});

export const createNoteTool = defineTool({
  name: "create_note",
  description:
    "Record a dated note — a phone call, meeting, or decision — and optionally attach it to one or more records at once (an entity, an investment, an external contact, and/or a document). Resolve names to ids with the list_* tools first. Use note_date for when the thing happened (a call date); it defaults to today.",
  kind: "write",
  inputSchema: z.object({
    body: z.string().min(1).describe("The note text."),
    note_date: z
      .string()
      .optional()
      .describe("ISO date (YYYY-MM-DD) the note is about; defaults to today."),
    links: z.array(noteLink).optional().default([]),
  }),
  dryRun: async (input) => ({
    summary: `Add a note${input.links?.length ? ` linked to ${input.links.length} record(s)` : ""}`,
    preview: { body: input.body, note_date: input.note_date, links: input.links },
  }),
  handler: async (input, ctx) => {
    const result = await dispatchAction(ctx, "create_note", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const updateNoteTool = defineTool({
  name: "update_note",
  description:
    "Edit an existing note: change its text and/or date, and attach or detach associations (entities, investments, people, documents) — additively. Use add_links to attach (e.g. add a person to a note after the fact) and remove_links to detach. Resolve names to ids with the list_* tools first.",
  kind: "write",
  inputSchema: z.object({
    note_id: z.string().uuid(),
    body: z.string().optional(),
    note_date: z.string().optional(),
    add_links: z.array(noteLink).optional(),
    remove_links: z.array(noteLink).optional(),
  }),
  dryRun: async (input) => ({
    summary: `Update note${input.add_links?.length ? ` (+${input.add_links.length} link)` : ""}${input.remove_links?.length ? ` (-${input.remove_links.length} link)` : ""}`,
    preview: input,
  }),
  handler: async (input, ctx) => {
    const result = await dispatchAction(ctx, "update_note", input);
    return { data: result.data };
  },
});

export const deleteNoteTool = defineTool({
  name: "delete_note",
  capability: "records:delete",
  description: "Delete a note. Its associations are removed with it.",
  kind: "write",
  inputSchema: z.object({ note_id: z.string().uuid() }),
  dryRun: async (input) => ({ summary: `Delete note ${input.note_id}` }),
  handler: async (input, ctx) => {
    const result = await dispatchAction(ctx, "delete_note", input);
    return { data: result.data };
  },
});

export const notesWriteTools: ToolDefinition[] = [createNoteTool, updateNoteTool, deleteNoteTool];
