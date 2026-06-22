/**
 * MCP chat orchestrator — the tool-use loop that drives Claude through
 * investigation (reads auto-execute) and mutation staging (writes dry-run +
 * buffer for user approval).
 *
 * Architecture (per `rhodes-mcp-tool-architecture-spec.md` Approval Flow):
 *
 *   1. Build tools list from the registry.
 *   2. Cached prefix: system prompt + tool definitions + per-org identity.
 *   3. Loop while response.stop_reason === "tool_use":
 *        a. Total-tool-call budget: max 30 per turn across reads + writes.
 *        b. For each tool_use block:
 *           - Read tool  → dispatch immediately, capture result.
 *           - Write tool → rate-limit check → dry-run → stage for approval;
 *             return `{ staged: true, summary }` as tool_result so Claude
 *             can continue the turn knowing the action was recorded.
 *        c. Append assistant + tool_result messages, continue.
 *   4. Return final text + stagedActions array.
 */

import { z } from "zod";
import type { ToolContext } from "./tool-context";
import type { ToolDefinition } from "./schema";
import { buildToolRegistry } from "./server";
import { SYSTEM_PROMPT } from "./system-prompt";
import { stageAction, type StagedAction } from "./staging";
import { logToolCall } from "./tool-call-log";
import { checkPerTurnWriteCap } from "./rate-limit-writes";
import { ToolError } from "./tool-helpers";
import type { StreamEvent } from "./stream-events";
import { emptyUsage, computeCostUsd } from "@/lib/pipeline/model-pricing";

// --- Limits (per spec §7) ---------------------------------------------------

/** Max tool-use blocks executed per turn. Beyond this we error and stop.
 *  Raised from 30 → 80 because multi-document orchestration legitimately
 *  needs that many calls in one turn (5 docs × ~6 calls each = 30+ before
 *  any reconciliation work). The previous cap was tripping the
 *  Silverhawk batch test mid-orchestration. Per-tool rate limits +
 *  per-hour write caps still bound runaway behavior. */
export const MAX_TOOL_CALLS_PER_TURN = 80;
/** Max loop iterations (Claude ↔ orchestrator round trips) per turn. */
export const MAX_LOOP_ITERATIONS = 8;
/** Summarize turns once history exceeds this many messages. */
export const MAX_HISTORY_TURNS = 20;
/** ...or this approximate token count (4 chars ≈ 1 token). */
export const MAX_HISTORY_TOKENS = 30_000;

// --- Types ------------------------------------------------------------------

/**
 * Structural shape of the Anthropic messages.create dependency. We inject it
 * instead of importing the full SDK type because the SDK's overloaded union
 * (streaming vs non-streaming) doesn't narrow cleanly in practice. The
 * production client (`new Anthropic().messages`) and the test mock both
 * satisfy this duck-typed interface.
 */
/** Minimal stream object shape matching the Anthropic SDK's MessageStream. */
export interface AnthropicStreamLike extends AsyncIterable<AnthropicStreamEvent> {
  finalMessage(): Promise<AnthropicMessageResponse>;
  currentMessage?: AnthropicMessageResponse;
}

export interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: { type?: string; text?: string };
}

export interface AnthropicClientLike {
  messages: {
    create: (opts: Record<string, unknown>) => Promise<AnthropicMessageResponse>;
    stream?: (opts: Record<string, unknown>) => AnthropicStreamLike;
  };
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface AnthropicMessageResponse {
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
  content: AnthropicContentBlock[];
}

export interface OrchestratorMessage {
  role: "user" | "assistant";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: string | any[];
}

export interface OrchestratorInput {
  ctx: ToolContext;
  userMessage: string;
  history: OrchestratorMessage[];
  /**
   * Optional page_context (entity_id, investment_id, document_id, etc.) —
   * threaded into the user's first message as a structured preamble so
   * Claude can use it as the implicit subject per system prompt rule.
   */
  pageContext?: Record<string, unknown> | null;
  /** Pre-built content blocks for file attachments in this turn. Built by
   *  contentBlocksForTurn() — images as base64, PDFs as document/text
   *  blocks, text files inline. Appended after the user's text message. */
  attachmentBlocks?: Array<Record<string, unknown>>;
  /**
   * Recent uploads in this chat session — authoritative document_id +
   * filename references that get rendered as a context block at the top
   * of the user message. Phase 2 of the chat unification: prevents the
   * UUID-hallucination class of bug where the orchestrator picks a wrong
   * doc_id in a follow-up turn because the original upload's preamble is
   * buried in history. With this block, the orchestrator always has fresh,
   * structured references for the last few uploads regardless of how deep
   * into a session it is.
   */
  recentUploads?: Array<{
    filename: string;
    document_id?: string | null;
    batch_id?: string | null;
    uploaded_at?: string;
  }>;
  /** User identity for "me"/"my" resolution. Appended to the system prompt. */
  userIdentity?: {
    name: string;
    email: string;
    orgName: string;
    primaryEntityId?: string;
    primaryEntityName?: string;
  };
  /** Anthropic client (injectable for tests). */
  anthropic: AnthropicClientLike;
  /** Model id — default opus 4.6. Override in tests / config experiments. */
  model?: string;
}

export interface OrchestratorResult {
  text: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    durationMs: number;
    error?: string;
  }>;
  stagedActions: StagedAction[];
  iterations: number;
  truncated: boolean;
  stopReason: string | null;
  usage?: { input: number; output: number; cacheRead: number; cacheCreation: number };
  costUsd?: number;
  model?: string;
}

// --- Tool definitions for the Anthropic API --------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnthropicTool = any;

/**
 * Convert our internal ToolDefinition[] into the Anthropic tool-use format.
 * Uses Zod 4's built-in `z.toJSONSchema`. Sorted alphabetically by the
 * registry itself so the prefix stays byte-stable for prompt caching.
 */
export function buildAnthropicTools(registry: ToolDefinition[]): AnthropicTool[] {
  return registry.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.inputSchema) as unknown,
  }));
}

// --- Dispatch ---------------------------------------------------------------

interface DispatchLogEntry {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  error?: string;
}

/**
 * Look up the tool by name, parse its args via Zod, and run the handler.
 * Returns the JSON-serializable result OR a structured error object Claude
 * can recover from ("the tool you called doesn't exist, try X").
 */
async function dispatchTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
  registry: ToolDefinition[],
  log: DispatchLogEntry[],
  stagedActions: StagedAction[],
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const started = Date.now();
  const tool = registry.find((t) => t.name === name);
  if (!tool) {
    const err = `tool "${name}" does not exist`;
    log.push({ name, args: {}, ok: false, durationMs: Date.now() - started, error: err });
    console.info("[mcp] tool dispatch", { name, ok: false, error: err });
    return { ok: false, error: err };
  }

  // Parse input (shared by both read and write paths).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = tool.inputSchema.parse(rawArgs);
  } catch (e) {
    const err = `invalid args for ${name}: ${(e as Error).message}`;
    log.push({ name, args: {}, ok: false, durationMs: Date.now() - started, error: err });
    return { ok: false, error: err };
  }

  // --- Write tools → stage for approval via dry-run. -------------------------
  if (tool.kind === "write") {
    if (!tool.dryRun) {
      const err = `write tool "${name}" has no dryRun implementation`;
      log.push({ name, args: parsed, ok: false, durationMs: Date.now() - started, error: err });
      return { ok: false, error: err };
    }
    try {
      // Per-turn cap stays at stage time (an agent staging 50 writes in
      // one turn is unmanageable regardless of approval). The per-hour cap
      // moved to apply-actions so skipped/discarded stages don't burn the
      // bucket — staging is a free preview, only applied writes count.
      checkPerTurnWriteCap(stagedActions.length);

      const staged = await stageAction(ctx, name, parsed, tool.dryRun);
      stagedActions.push(staged);
      const durationMs = Date.now() - started;
      log.push({ name, args: parsed, ok: true, durationMs });
      logToolCall(ctx, {
        tool_name: name,
        arg_keys: Object.keys(parsed),
        kind: "write",
        ok: true,
        duration_ms: durationMs,
        staged: true,
      });
      console.info("[mcp] tool staged", { name, durationMs, summary: staged.summary });
      return {
        ok: true,
        result: {
          staged: true,
          summary: staged.summary,
          message: "Staged for user approval. The action will execute only if the user approves.",
        },
      };
    } catch (e) {
      const durationMs = Date.now() - started;
      const errCode = e instanceof ToolError ? e.code : "unknown";
      const errMsg = (e as Error).message;
      log.push({ name, args: parsed, ok: false, durationMs, error: errMsg });
      logToolCall(ctx, {
        tool_name: name,
        arg_keys: Object.keys(parsed),
        kind: "write",
        ok: false,
        error_code: errCode,
        error_message: errMsg,
        duration_ms: durationMs,
        staged: false,
      });
      return { ok: false, error: errMsg };
    }
  }

  // --- Read tools → execute immediately. ------------------------------------
  try {
    const result = await tool.handler(parsed, ctx);
    const durationMs = Date.now() - started;
    log.push({ name, args: parsed, ok: true, durationMs });
    logToolCall(ctx, {
      tool_name: name,
      arg_keys: Object.keys(parsed),
      kind: "read",
      ok: true,
      duration_ms: durationMs,
    });
    console.info("[mcp] tool dispatch", {
      name,
      ok: true,
      durationMs,
      argKeys: Object.keys(parsed),
      resultSize:
        Array.isArray((result as { data: unknown }).data)
          ? ((result as { data: unknown[] }).data.length)
          : 1,
    });
    return { ok: true, result };
  } catch (e) {
    const durationMs = Date.now() - started;
    const err = (e as Error).message;
    log.push({ name, args: parsed, ok: false, durationMs, error: err });
    logToolCall(ctx, {
      tool_name: name,
      arg_keys: Object.keys(parsed),
      kind: "read",
      ok: false,
      error_code: e instanceof ToolError ? e.code : "unknown",
      error_message: err,
      duration_ms: durationMs,
    });
    console.info("[mcp] tool dispatch", { name, ok: false, error: err });
    return { ok: false, error: err };
  }
}

// --- History truncation -----------------------------------------------------

/**
 * ~4 chars/token. Good enough for the threshold check; real tokenization
 * isn't worth the dep. Each content block contributes one field to the sum —
 * branch by shape rather than adding multiple fields per block, which would
 * double-count tool_use blocks (text + input) or misestimate tool_result
 * blocks with both content and is_error set.
 */
export function approximateTokens(messages: OrchestratorMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      total += m.content.length;
      continue;
    }
    for (const block of m.content as Array<Record<string, unknown>>) {
      if (typeof block.text === "string") {
        total += block.text.length;
      } else if (block.input !== undefined) {
        total += JSON.stringify(block.input).length;
      } else if (typeof block.content === "string") {
        total += block.content.length;
      }
    }
  }
  return Math.ceil(total / 4);
}

export interface TruncateOptions {
  maxTurns?: number;
  maxTokens?: number;
  /** Turns to keep verbatim at the tail. Default 15. */
  keepTail?: number;
}

/**
 * If `history` exceeds the turn or token thresholds, replace the leading
 * portion with a synthetic "[summary of earlier turns]" user message and
 * keep the last `keepTail` turns verbatim. The originals stay in the DB —
 * this only shrinks what goes to the Anthropic API.
 */
export function truncateHistory(
  history: OrchestratorMessage[],
  opts: TruncateOptions = {},
): { messages: OrchestratorMessage[]; truncated: boolean } {
  const maxTurns = opts.maxTurns ?? MAX_HISTORY_TURNS;
  const maxTokens = opts.maxTokens ?? MAX_HISTORY_TOKENS;
  const keepTail = opts.keepTail ?? 15;

  const overTurns = history.length > maxTurns;
  const overTokens = approximateTokens(history) > maxTokens;
  if (!overTurns && !overTokens) {
    return { messages: history, truncated: false };
  }

  const cutoff = Math.max(0, history.length - keepTail);
  const dropped = history.slice(0, cutoff);
  const kept = history.slice(cutoff);

  // Extract any user-visible gist from the dropped slice. The spec permits a
  // simple "[earlier conversation summarized]" — a separate summarizer call
  // is a Phase 2 upgrade. For now we just note the count so Claude knows the
  // history was trimmed.
  const summary: OrchestratorMessage = {
    role: "user",
    content: `[Earlier conversation summarized — ${dropped.length} prior turns omitted to stay under the context budget. Ask the user or call tools if specific earlier context is needed.]`,
  };

  return { messages: [summary, ...kept], truncated: true };
}

// --- The streaming generator -------------------------------------------------

/**
 * Async generator that yields StreamEvent objects as the orchestrator
 * processes a turn. The SSE route iterates this and enqueues each event.
 * The non-streaming `runOrchestrator` collects events and returns the
 * final result — fully backward-compatible.
 */
export async function* runOrchestratorStreaming(
  input: OrchestratorInput,
): AsyncGenerator<StreamEvent> {
  const registry = buildToolRegistry();
  const anthropicTools = buildAnthropicTools(registry);

  const { messages: trimmedHistory, truncated } = truncateHistory(input.history);

  const userBlocks: Array<Record<string, unknown>> = [];
  if (input.pageContext && Object.keys(input.pageContext).length > 0) {
    userBlocks.push({
      type: "text",
      text: `<page_context>${JSON.stringify(input.pageContext)}</page_context>`,
    });
  }
  if (input.recentUploads && input.recentUploads.length > 0) {
    // Authoritative reference for doc_ids the user uploaded recently. Each
    // line is structured so the model can copy verbatim into write-tool
    // arguments without scanning history or guessing.
    const lines = input.recentUploads.map((u) => {
      const parts = [`- ${u.filename}`];
      if (u.document_id) parts.push(`document_id: ${u.document_id}`);
      if (u.batch_id) parts.push(`batch_id: ${u.batch_id}`);
      if (u.uploaded_at) parts.push(`uploaded: ${u.uploaded_at}`);
      return parts.join(" · ");
    });
    userBlocks.push({
      type: "text",
      text: `<recent_uploads>\n${lines.join("\n")}\n</recent_uploads>`,
    });
  }
  userBlocks.push({ type: "text", text: input.userMessage });
  if (input.attachmentBlocks?.length) {
    userBlocks.push(...input.attachmentBlocks);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    ...trimmedHistory,
    { role: "user", content: userBlocks },
  ];

  const toolCallsLog: DispatchLogEntry[] = [];
  const stagedActions: StagedAction[] = [];
  let iterations = 0;
  let stopReason: string | null = null;
  let accumulatedText = "";
  // Cost telemetry: accumulate token usage across iterations (chat runs on
  // Opus — ~5x Sonnet — so this is a material cost center to measure).
  const usageTotals = emptyUsage();
  const model = input.model ?? "claude-opus-4-6";
  const addUsage = (raw: unknown) => {
    const u = (raw ?? {}) as {
      input_tokens?: number; output_tokens?: number;
      cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
    };
    usageTotals.input += u.input_tokens || 0;
    usageTotals.output += u.output_tokens || 0;
    usageTotals.cacheRead += u.cache_read_input_tokens || 0;
    usageTotals.cacheCreation += u.cache_creation_input_tokens || 0;
  };

  let systemPrompt = SYSTEM_PROMPT;
  if (input.userIdentity) {
    let identityBlock = `\n\n# Your user\nName: ${input.userIdentity.name}\nEmail: ${input.userIdentity.email}\nOrganization: ${input.userIdentity.orgName}`;
    if (input.userIdentity.primaryEntityId && input.userIdentity.primaryEntityName) {
      identityBlock += `\nPersonal entity: ${input.userIdentity.primaryEntityName} (entity_id: ${input.userIdentity.primaryEntityId})`;
      identityBlock += `\n\nWhen the user says "me", "my", or "mine", their personal entity is ${input.userIdentity.primaryEntityName}. To understand the full scope of "my" — distributions, documents, entities — follow the relationships from this entity: look up relationships where ${input.userIdentity.primaryEntityName} is connected (member, trustee, beneficiary, manager, owner) to find all related entities. The user's interests flow through trusts, LLCs, and other structures — don't limit to direct name matches.`;
    } else {
      identityBlock += `\n\nWhen the user says "me", "my", or "mine", they are referring to themselves — ${input.userIdentity.name}. Resolve their identity by searching entities for their name if needed.`;
    }
    systemPrompt += identityBlock;
  }

  const apiParams = {
    model,
    // 4096 was tight for tool-heavy turns: a 15-action staging batch with
    // brief per-action narration regularly exceeded that budget, leaving the
    // turn truncated mid-prose with zero staged actions. 16k gives the model
    // comfortable headroom to narrate AND emit tool_use blocks in one
    // iteration. Each iteration in the loop gets its own budget, so this
    // doesn't compound across multi-iteration turns.
    max_tokens: 16384,
    // Prompt caching: mark cache_control on the system block so the system
    // prompt + tool schemas (which precede it in cache order: tools, then
    // system, then messages) are cached for the 5-minute TTL window. Org
    // context and the user message live in `messages` and stay fresh on
    // every call — no staleness risk because dynamic data isn't in the
    // cached prefix. Cached blocks bill at ~10% of normal input cost.
    system: [
      {
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      },
    ],
    tools: anthropicTools,
    messages,
  };

  while (iterations < MAX_LOOP_ITERATIONS) {
    iterations++;
    yield { type: "iteration", iteration: iterations, toolCallsSoFar: toolCallsLog.length };

    // --- Get the response (streaming if SDK supports it, else blocking) ---
    let currentIterText = "";
    let content: AnthropicContentBlock[];

    if (input.anthropic.messages.stream) {
      // Streaming path — yield text_delta events as they arrive.
      const stream = input.anthropic.messages.stream(apiParams);
      const pendingToolUses: Array<Extract<AnthropicContentBlock, { type: "tool_use" }>> = [];

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          currentIterText += event.delta.text;
          yield { type: "text_delta", text: event.delta.text };
        }
        if (event.type === "content_block_stop" && stream.currentMessage) {
          const block = stream.currentMessage.content[event.index ?? 0];
          if (block && block.type === "tool_use") {
            pendingToolUses.push(block as Extract<AnthropicContentBlock, { type: "tool_use" }>);
          }
        }
      }

      const finalMsg = await stream.finalMessage();
      addUsage((finalMsg as unknown as Record<string, unknown>).usage);
      stopReason = finalMsg.stop_reason ?? null;
      content = finalMsg.content;
    } else {
      // Non-streaming fallback (test mocks, etc.)
      const response = await input.anthropic.messages.create(apiParams);
      addUsage((response as unknown as Record<string, unknown>).usage);
      stopReason = response.stop_reason ?? null;
      content = response.content;

      // Extract text and yield as a single delta.
      const textBlocks = content.filter(
        (b): b is Extract<AnthropicContentBlock, { type: "text" }> => b.type === "text",
      );
      if (textBlocks.length > 0) {
        currentIterText = textBlocks.map((b) => b.text).join("\n");
        yield { type: "text_delta", text: currentIterText };
      }
    }

    if (currentIterText) accumulatedText += currentIterText;

    if (stopReason !== "tool_use") break;

    const toolUses = content.filter(
      (b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use",
    );

    if (toolCallsLog.length + toolUses.length > MAX_TOOL_CALLS_PER_TURN) {
      const msg = `[orchestrator stopped: tool call budget (${MAX_TOOL_CALLS_PER_TURN}/turn) exceeded]`;
      accumulatedText = (accumulatedText ? accumulatedText + "\n\n" : "") + msg;
      yield { type: "text_delta", text: "\n\n" + msg };
      break;
    }

    const toolResults: Array<Extract<AnthropicContentBlock, { type: "tool_result" }>> = [];
    for (const tu of toolUses) {
      yield { type: "tool_start", id: tu.id, name: tu.name, index: toolCallsLog.length };
      const dispatched = await dispatchTool(tu.name, tu.input, input.ctx, registry, toolCallsLog, stagedActions);
      const lastLog = toolCallsLog[toolCallsLog.length - 1];

      if (dispatched.ok) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(dispatched.result),
        });
        // If a write tool was staged, emit the staged event.
        const lastStaged = stagedActions[stagedActions.length - 1];
        if (lastStaged && lastStaged.tool === tu.name) {
          yield {
            type: "tool_staged",
            id: lastStaged.id,
            tool: lastStaged.tool,
            summary: lastStaged.summary,
            resource_preview: lastStaged.resource_preview,
          };
        }
      } else {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify({ error: dispatched.error }),
          is_error: true,
        });
      }

      yield {
        type: "tool_complete",
        id: tu.id,
        name: tu.name,
        ok: dispatched.ok,
        durationMs: lastLog?.durationMs ?? 0,
        error: dispatched.ok ? undefined : dispatched.error,
        index: toolCallsLog.length - 1,
      };
    }

    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: toolResults });
  }

  if (iterations >= MAX_LOOP_ITERATIONS && stopReason === "tool_use") {
    const msg = `[orchestrator stopped: iteration cap (${MAX_LOOP_ITERATIONS}) reached; returning partial answer]`;
    accumulatedText = (accumulatedText ? accumulatedText + "\n\n" : "") + msg;
    yield { type: "text_delta", text: "\n\n" + msg };
  }

  yield {
    type: "done",
    text: accumulatedText,
    toolCalls: toolCallsLog.map((e) => ({
      name: e.name,
      args: e.args,
      ok: e.ok,
      durationMs: e.durationMs,
      ...(e.error ? { error: e.error } : {}),
    })),
    stagedActions,
    iterations,
    truncated,
    stopReason,
    usage: { ...usageTotals },
    costUsd: computeCostUsd(model, usageTotals),
    model,
  };
}

// --- Non-streaming wrapper (backward-compatible) ----------------------------

/**
 * Consumes the streaming generator and returns the final result. Used by the
 * smoke harness, tests, and any callers that don't need progressive events.
 */
export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  let result: OrchestratorResult | undefined;
  for await (const event of runOrchestratorStreaming(input)) {
    if (event.type === "done") {
      result = event;
    }
  }
  if (!result) throw new Error("orchestrator stream ended without done event");
  return result;
}
