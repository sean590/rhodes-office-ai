// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MessageBubble } from "../message-bubble";
import type { ChatMessage } from "@/lib/types/chat";

afterEach(cleanup);

function baseMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m-1",
    session_id: "s-1",
    role: "assistant",
    content: "Here's the answer.",
    metadata: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("<MessageBubble /> — MCP v2 tool-call trace", () => {
  it("renders the ToolCallTrace affordance when tool_calls metadata is present", () => {
    const msg = baseMessage({
      metadata: {
        mcp_chat: true,
        iterations: 2,
        truncated: false,
        stop_reason: "end_turn",
        tool_calls: [
          { name: "list_entities", ok: true, duration_ms: 120 },
          { name: "get_portfolio_summary", ok: true, duration_ms: 340 },
        ],
      },
    });
    render(<MessageBubble message={msg} refs={[]} />);
    expect(screen.getByTestId("tool-call-trace")).toBeTruthy();
    expect(screen.getByText(/Searched entities/)).toBeTruthy();
    expect(screen.getByText(/Computed a portfolio summary/)).toBeTruthy();
  });

  it("does NOT render the trace for legacy messages with no tool_calls metadata", () => {
    const msg = baseMessage({ metadata: null });
    render(<MessageBubble message={msg} refs={[]} />);
    expect(screen.queryByTestId("tool-call-trace")).toBeNull();
  });

  it("does NOT render the trace when metadata carries other fields but no tool_calls", () => {
    const msg = baseMessage({
      metadata: {
        // Legacy assistant message — has a batch_id from the pipeline flow
        // but no tool_calls. Trace should stay hidden.
        batch_id: "b-1",
        processing_status: "completed",
      },
    });
    render(<MessageBubble message={msg} refs={[]} />);
    expect(screen.queryByTestId("tool-call-trace")).toBeNull();
  });
});
