/**
 * Shared Zod schemas + tool registry types for the MCP server.
 *
 * Tools are defined as a `Tool<A, R>` record: a Zod input schema + a handler
 * that receives parsed args and the per-turn `ToolContext`. A single registry
 * is the source of truth. `buildMcpServer(ctx)` wraps each entry into the
 * MCP SDK's `registerTool` surface; tests can call handlers directly.
 *
 * This two-layer split matters:
 * - The registry is easy to test (no transport, no SDK plumbing).
 * - The SDK wrapper preserves the option to expose the same tools to an
 *   external MCP client later without changing the handlers.
 */

import { z } from "zod";
import type { ToolContext } from "./tool-context";
import type { DryRunResult } from "./staging";
import { can, type Capability } from "@/lib/authz/policy";

export interface ToolResult<T> {
  data: T;
  truncated?: boolean;
  /** Optional rollup metadata serialized alongside data. Used by list tools
   *  that want to surface counts (e.g. list_document_expectations.summary). */
  summary?: unknown;
}

export type ToolHandler<Args, Result> = (
  args: Args,
  ctx: ToolContext,
) => Promise<ToolResult<Result>>;

export type ToolDryRun<Args> = (
  args: Args,
  ctx: ToolContext,
) => Promise<DryRunResult>;

export interface ToolDefinition<
  Schema extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
  Result = unknown,
> {
  name: string;
  description: string;
  kind: "read" | "write";
  /** RBAC capability required to run this (write) tool. Defaults to
   *  `records:write` (member+) via `toolCapability()`. Sensitive tools
   *  (delete/archive top-level or financial records, send-to-provider) set a
   *  higher capability so the chat agent obeys the same matrix as the REST API. */
  capability?: Capability;
  inputSchema: Schema;
  handler: ToolHandler<z.infer<Schema>, Result>;
  /** Write tools: preview-only path for the staging buffer. Runs ownership
   *  checks, Zod validation, context fetches — but NO mutation. Returns a
   *  human-readable summary + preview for the approval card. */
  dryRun?: ToolDryRun<z.infer<Schema>>;
}

/** The capability a write tool requires (default: records:write / member+). */
export function toolCapability(tool: ToolDefinition): Capability {
  return tool.capability ?? "records:write";
}

/**
 * RBAC gate for a tool, shared by the orchestrator (stage time, for a graceful
 * agent-facing message) and apply-adapter (apply time, the real boundary).
 * Returns null if allowed, or a human-readable permission message if denied.
 */
export function toolPermissionError(
  tool: ToolDefinition,
  orgRole: import("./tool-context").ToolContext["orgRole"],
): string | null {
  if (tool.kind !== "write") return null;
  const cap = toolCapability(tool);
  if (can(orgRole, cap)) return null;
  const who =
    cap === "records:delete" || cap === "providers:send" ? "an admin" : "a higher role";
  return `Your role ("${orgRole}") can't perform "${tool.name}" — this requires ${who}. Ask an admin to do it.`;
}

/**
 * Helper constructor — preserves the full generic signature so handler args
 * are inferred from the Zod schema at call sites.
 */
export function defineTool<
  Schema extends z.ZodObject<z.ZodRawShape>,
  Result,
>(def: ToolDefinition<Schema, Result>): ToolDefinition<Schema, Result> {
  return def;
}

/** Default list-tool cap; exceed returns `truncated: true`. */
export const MAX_LIST_ROWS = 100;
/** Default search-tool cap. */
export const MAX_SEARCH_ROWS = 50;
