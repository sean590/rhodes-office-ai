/**
 * MCP server construction.
 *
 * Each chat turn builds a fresh server bound to a per-turn ToolContext; that
 * context carries `orgId` / `userId` / the supabase admin client, and tool
 * handlers close over it via the registry. No cross-turn state lives on the
 * server.
 *
 * Tools are registered in deterministic (alphabetical) name order so the
 * cached prefix generated downstream by the orchestrator is byte-stable
 * across turns and sessions. See the spec's Caching Strategy section.
 *
 * Registered domains: entities, directory, documents, investments,
 * aggregations, audit. All Phase 1 read domains are live.
 *
 * Out of scope here: the large-document navigation tools
 * (`get_document_outline`, `get_document_section`, `search_document_text`,
 * `scan_document_for_fields`) live in the master spec's Document Handling
 * section and block on the uniform upload handler landing first — not a
 * Phase 1 gap.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./tool-context";
import type { ToolDefinition } from "./schema";
import { entityTools } from "./tools/entities";
import { directoryTools } from "./tools/directory";
import { documentTools } from "./tools/documents";
import { investmentTools } from "./tools/investments";
import { aggregationTools } from "./tools/aggregations";
import { auditTools } from "./tools/audit";
import { documentNavTools } from "./tools/document-nav";
import { complianceTools } from "./tools/compliance";
import { serviceProviderTools } from "./tools/service-providers";
import { entityWriteTools } from "./tools/entities-write";
import { directoryWriteTools } from "./tools/directory-write";
import { investmentWriteTools } from "./tools/investments-write";
import { documentWriteTools } from "./tools/documents-write";
import { queueWriteTools } from "./tools/queue-write";
import { serviceProviderWriteTools } from "./tools/service-providers-write";

/**
 * Single registry of every tool, sorted by name. Tests consume this directly
 * to call handlers without going through the SDK transport.
 */
export function buildToolRegistry(): ToolDefinition[] {
  const tools = [
    ...entityTools,
    ...directoryTools,
    ...documentTools,
    ...investmentTools,
    ...aggregationTools,
    ...auditTools,
    ...documentNavTools,
    ...complianceTools,
    ...serviceProviderTools,
    ...entityWriteTools,
    ...directoryWriteTools,
    ...investmentWriteTools,
    ...documentWriteTools,
    ...queueWriteTools,
    ...serviceProviderWriteTools,
  ];
  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

/** Register a tool definition with the MCP server. */
function registerTool(server: McpServer, tool: ToolDefinition, ctx: ToolContext) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema.shape,
    },
    async (rawArgs: unknown) => {
      const parsed = tool.inputSchema.parse(rawArgs);
      const result = await tool.handler(parsed, ctx);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}

export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "rhodes", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  for (const tool of buildToolRegistry()) {
    registerTool(server, tool, ctx);
  }

  return server;
}
