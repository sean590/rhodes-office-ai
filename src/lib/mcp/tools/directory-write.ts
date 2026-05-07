/**
 * Directory-domain write tools — 3 tools.
 * create_directory_entry, update_directory_entry, archive_directory_entry.
 */

import { z } from "zod";
import { defineTool, type ToolDefinition } from "../schema";
import { verifyResourceOwnership } from "../ownership";
import { dispatchAction } from "../apply-dispatch";
import { resolveName } from "../resolve-names";

export const createDirectoryEntryTool = defineTool({
  name: "create_directory_entry",
  description:
    "Create a new directory entry (individual, external entity, or trust). Skips if a matching name already exists.",
  kind: "write",
  inputSchema: z.object({
    name: z.string().min(1),
    type: z.enum(["individual", "external_entity", "trust"]).optional(),
    email: z.string().optional().nullable(),
  }),
  dryRun: async (input) => ({
    summary: `Create directory entry: ${input.name} (${input.type ?? "individual"})`,
    preview: input,
  }),
  handler: async (input, ctx) => {
    const result = await dispatchAction(ctx, "create_directory_entry", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const updateDirectoryEntryTool = defineTool({
  name: "update_directory_entry",
  description: "Update a directory entry's name, type, or email.",
  kind: "write",
  inputSchema: z.object({
    directory_entry_id: z.string().uuid(),
    name: z.string().optional(),
    type: z.enum(["individual", "external_entity", "trust"]).optional(),
    email: z.string().optional().nullable(),
  }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "directory_entry", resourceId: input.directory_entry_id });
    const name = await resolveName(ctx, "directory_entry", input.directory_entry_id);
    return { summary: `Update directory entry "${name}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "directory_entry", resourceId: input.directory_entry_id });
    const result = await dispatchAction(ctx, "create_directory_entry", {
      ...input,
      name: input.name ?? "",
    });
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const archiveDirectoryEntryTool = defineTool({
  name: "archive_directory_entry",
  description:
    "Soft-delete a directory entry. Refuses if the entry is still referenced by active allocations, co-investors, or members.",
  kind: "write",
  inputSchema: z.object({ directory_entry_id: z.string().uuid() }),
  dryRun: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "directory_entry", resourceId: input.directory_entry_id });
    const name = await resolveName(ctx, "directory_entry", input.directory_entry_id);
    return { summary: `Archive directory entry "${name}"` };
  },
  handler: async (input, ctx) => {
    await verifyResourceOwnership(ctx, { resourceType: "directory_entry", resourceId: input.directory_entry_id });
    const result = await dispatchAction(ctx, "archive_directory_entry", input);
    return { data: result.data, audit_event_id: result.audit_event_id };
  },
});

export const directoryWriteTools: ToolDefinition[] = [
  createDirectoryEntryTool,
  updateDirectoryEntryTool,
  archiveDirectoryEntryTool,
];
