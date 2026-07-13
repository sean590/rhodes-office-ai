import { describe, it, expect, vi } from "vitest";
import {
  runOrchestrator,
  truncateHistory,
  buildAnthropicTools,
  approximateTokens,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_LOOP_ITERATIONS,
  MAX_HISTORY_TURNS,
  MAX_HISTORY_TOKENS,
  type OrchestratorMessage,
} from "../orchestrator";
import type { ToolContext } from "../tool-context";
import { buildToolRegistry } from "../server";

// --- Stub Anthropic client --------------------------------------------------
//
// The mock accepts a scripted queue of responses; each call to messages.create
// pops the next. Each response follows the Anthropic messages.create result
// shape: { stop_reason, content: Array<{type,...}> }.

interface ScriptedResponse {
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
}

function makeClient(queue: ScriptedResponse[]) {
  const calls: Array<{ messages: unknown[]; tools: unknown[]; system: string }> = [];
  const create = vi.fn(async (opts: Record<string, unknown>) => {
    calls.push({
      messages: opts.messages as unknown[],
      tools: opts.tools as unknown[],
      system: opts.system as string,
    });
    if (queue.length === 0) throw new Error("mock Anthropic client exhausted");
    return queue.shift()!;
  });
  return {
    client: { messages: { create } },
    calls,
    create,
  };
}

// Minimal ToolContext with a supabase mock that returns empty arrays for
// any query — the orchestrator isn't asserting DB behavior here, only
// control flow. Individual tool handlers execute their Zod parse + handler,
// so queries fire but return nothing.
function makeCtx(): ToolContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const passthrough = () => chain;
  chain.select = passthrough;
  chain.eq = passthrough;
  chain.ilike = passthrough;
  chain.order = passthrough;
  chain.limit = passthrough;
  chain.is = passthrough;
  chain.neq = passthrough;
  chain.lt = passthrough;
  chain.lte = passthrough;
  chain.gte = passthrough;
  chain.in = passthrough;
  chain.insert = () => Promise.resolve({ data: null, error: null });
  chain.single = () => Promise.resolve({ data: { id: "e-1" }, error: null });
  chain.maybeSingle = () => Promise.resolve({ data: { id: "e-1" }, error: null });
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: [], error: null });
  return {
    userId: "u",
    orgId: "org-A",
    orgRole: "owner",
    sessionId: "s",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from: () => chain } as any,
    redact: (o) => o,
  };
}

// ---------------------------------------------------------------------------

describe("buildAnthropicTools", () => {
  it("converts every registry tool to an Anthropic tool definition", () => {
    const registry = buildToolRegistry();
    const tools = buildAnthropicTools(registry);
    expect(tools.length).toBe(registry.length);
    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.input_schema).toBe("object");
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("emits tools in alphabetical order (byte-stable for cache prefix)", () => {
    const tools = buildAnthropicTools(buildToolRegistry());
    const names = tools.map((t) => t.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------

describe("approximateTokens", () => {
  it("counts a text block once (not text + other fields)", () => {
    // Single tool_use block has an `input` field. Single tool_result block
    // has a `content` string. A string-content message just counts its length.
    // None of these should be double-counted.
    const msgs: OrchestratorMessage[] = [
      { role: "user", content: "hello world" }, // 11 chars
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me look" }, // 11 chars
          {
            type: "tool_use",
            id: "tu_1",
            name: "list_entities",
            input: { limit: 5 }, // JSON = {"limit":5} → 11 chars
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: "some rows here", // 14 chars
          },
        ],
      },
    ];
    // Total chars: 11 + 11 + 11 + 14 = 47; ceil(47/4) = 12.
    expect(approximateTokens(msgs)).toBe(12);
  });

  it("does not double-count when a block happens to carry multiple fields", () => {
    // Hypothetical malformed block with both `text` and `input` — the branch
    // picks text first and ignores input, preventing over-count.
    const msgs: OrchestratorMessage[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tu",
            name: "x",
            text: "abcd", // 4 chars
            input: { longer: "payload-value" }, // would add 27 chars if summed
          } as unknown as { type: string },
        ],
      },
    ];
    // Only the `text` field contributes: ceil(4/4) = 1.
    expect(approximateTokens(msgs)).toBe(1);
  });
});

describe("truncateHistory", () => {
  it("leaves short history untouched", () => {
    const hist: OrchestratorMessage[] = Array.from({ length: 3 }, (_, i) => ({
      role: "user",
      content: `msg ${i}`,
    }));
    const r = truncateHistory(hist);
    expect(r.truncated).toBe(false);
    expect(r.messages).toEqual(hist);
  });

  it("summarizes when turn count exceeds threshold", () => {
    const hist: OrchestratorMessage[] = Array.from(
      { length: MAX_HISTORY_TURNS + 5 },
      (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `msg ${i}` }),
    );
    const r = truncateHistory(hist, { keepTail: 5 });
    expect(r.truncated).toBe(true);
    // 1 summary + 5 kept
    expect(r.messages.length).toBe(6);
    expect(r.messages[0].role).toBe("user");
    expect((r.messages[0].content as string)).toMatch(/Earlier conversation summarized/);
  });

  it("summarizes when token count exceeds threshold even if turn count is fine", () => {
    const bigString = "x".repeat(MAX_HISTORY_TOKENS * 4 + 100);
    const hist: OrchestratorMessage[] = [
      { role: "user", content: bigString },
      { role: "assistant", content: "ok" },
    ];
    const r = truncateHistory(hist, { keepTail: 1 });
    expect(r.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("runOrchestrator — control flow", () => {
  it("returns the text on a straight end_turn (no tool use)", async () => {
    const { client } = makeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "hello" }] },
    ]);
    const result = await runOrchestrator({
      ctx: makeCtx(),
      userMessage: "hi",
      history: [],
      anthropic: client,
    });
    expect(result.text).toBe("hello");
    expect(result.toolCalls).toEqual([]);
    expect(result.iterations).toBe(1);
    expect(result.stopReason).toBe("end_turn");
  });

  it("dispatches a tool_use, appends the result, and continues", async () => {
    const { client, calls } = makeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "let me check" },
          {
            type: "tool_use",
            id: "tu_1",
            name: "list_entities",
            input: { limit: 5 },
          },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "here's what i found" }],
      },
    ]);
    const result = await runOrchestrator({
      ctx: makeCtx(),
      userMessage: "list my entities",
      history: [],
      anthropic: client,
    });
    expect(result.iterations).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("list_entities");
    expect(result.toolCalls[0].ok).toBe(true);
    // Text accumulates across iterations: "let me check" (iter 1) + "here's what i found" (iter 2).
    expect(result.text).toBe("let me checkhere's what i found");
    // Second call to Claude should carry the assistant message + tool_result.
    const secondCall = calls[1];
    const msgs = secondCall.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.some((m) => m.role === "assistant")).toBe(true);
    // The trailing user message is the tool_result block.
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe("user");
    expect(Array.isArray(last.content)).toBe(true);
    const toolResultBlock = (last.content as Array<Record<string, unknown>>)[0];
    expect(toolResultBlock.type).toBe("tool_result");
    expect(toolResultBlock.tool_use_id).toBe("tu_1");
  });

  it("surfaces an error tool_result when the tool name is unknown", async () => {
    const { client } = makeClient([
      {
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tu_1", name: "no_such_tool", input: {} },
        ],
      },
      {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "sorry, I'll try differently" }],
      },
    ]);
    const result = await runOrchestrator({
      ctx: makeCtx(),
      userMessage: "do the thing",
      history: [],
      anthropic: client,
    });
    expect(result.toolCalls[0].ok).toBe(false);
    expect(result.toolCalls[0].error).toMatch(/does not exist/);
  });
});

describe("runOrchestrator — rate limit + iteration cap", () => {
  it("stops when the per-turn tool-call budget is exceeded", async () => {
    // Single response with MAX_TOOL_CALLS_PER_TURN + 1 tool_use blocks.
    const toolUses = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, (_, i) => ({
      type: "tool_use" as const,
      id: `tu_${i}`,
      name: "list_entities",
      input: { limit: 1 },
    }));
    const { client, create } = makeClient([
      { stop_reason: "tool_use", content: toolUses },
    ]);
    const result = await runOrchestrator({
      ctx: makeCtx(),
      userMessage: "loop",
      history: [],
      anthropic: client,
    });
    expect(result.text).toMatch(/tool call budget/);
    // No tools should have dispatched — the cap triggers before any run.
    expect(result.toolCalls).toEqual([]);
    // Only one Claude call — loop terminated on budget check.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("stops at the iteration cap when Claude keeps requesting tool_use", async () => {
    // Every response is a single tool_use so the loop never gets end_turn.
    const queue: ScriptedResponse[] = Array.from({ length: MAX_LOOP_ITERATIONS + 2 }, (_, i) => ({
      stop_reason: "tool_use" as const,
      content: [
        {
          type: "tool_use" as const,
          id: `tu_${i}`,
          name: "list_entities",
          input: { limit: 1 },
        },
      ],
    }));
    const { client, create } = makeClient(queue);
    const result = await runOrchestrator({
      ctx: makeCtx(),
      userMessage: "loop forever",
      history: [],
      anthropic: client,
    });
    expect(result.iterations).toBe(MAX_LOOP_ITERATIONS);
    expect(result.text).toMatch(/iteration cap/);
    expect(create).toHaveBeenCalledTimes(MAX_LOOP_ITERATIONS);
  });
});

describe("runOrchestrator — page_context injection", () => {
  it("prepends page_context as a structured block on the first user message", async () => {
    const { client, calls } = makeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    await runOrchestrator({
      ctx: makeCtx(),
      userMessage: "tell me about this entity",
      history: [],
      pageContext: { entityId: "e-1", entityName: "Acme" },
      anthropic: client,
    });
    const firstCall = calls[0];
    const msgs = firstCall.messages as Array<{ role: string; content: unknown }>;
    const userMsg = msgs[msgs.length - 1];
    expect(userMsg.role).toBe("user");
    const blocks = userMsg.content as Array<Record<string, unknown>>;
    expect(blocks[0].type).toBe("text");
    expect(blocks[0].text).toMatch(/<page_context>.*entityId.*e-1.*<\/page_context>/);
    expect(blocks[1].text).toBe("tell me about this entity");
  });

  it("does not add a page_context block when pageContext is null/empty", async () => {
    const { client, calls } = makeClient([
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    await runOrchestrator({
      ctx: makeCtx(),
      userMessage: "hi",
      history: [],
      pageContext: {},
      anthropic: client,
    });
    const msgs = calls[0].messages as Array<{ content: unknown }>;
    const userMsg = msgs[msgs.length - 1];
    const blocks = userMsg.content as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(1);
    expect(blocks[0].text).toBe("hi");
  });
});
