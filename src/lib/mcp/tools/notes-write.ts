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

export const notesWriteTools: ToolDefinition[] = [createNoteTool];
